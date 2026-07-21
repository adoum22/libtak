"""Versioned synchronization API shared by local and cloud deployments."""

from __future__ import annotations

import logging
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any

from django.conf import settings
from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from django.utils.crypto import constant_time_compare
from django.utils.dateparse import parse_datetime
from rest_framework import serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.response import Response
from drf_spectacular.utils import OpenApiResponse, extend_schema

from core.sync_service import (
    SYNC_PROTOCOL,
    SYNC_PROTOCOL_VERSION,
    make_stock_sync_id,
    make_sync_id,
    normalize_local_id,
    normalize_origin_id,
)
from inventory.models import (
    Category,
    Product,
    ProductCostLayer,
    Supplier,
    SyncStockSnapshot,
)
from sales.models import Return, ReturnItem, Sale, SaleItem

logger = logging.getLogger(__name__)

MAX_RECORDS_PER_BATCH = 10_000
MAX_ITEMS_PER_RECORD = 1_000
RETURN_STATUS_ORDER = {
    Return.ReturnStatus.PENDING: 0,
    Return.ReturnStatus.APPROVED: 1,
    Return.ReturnStatus.REJECTED: 2,
    Return.ReturnStatus.COMPLETED: 2,
}
TERMINAL_RETURN_STATUSES = {
    Return.ReturnStatus.REJECTED,
    Return.ReturnStatus.COMPLETED,
}


class SyncStatusResponseSerializer(serializers.Serializer):
    cloud_configured = serializers.BooleanField()
    last_sync = serializers.DateTimeField(allow_null=True)
    pending_sales = serializers.IntegerField(min_value=0)
    pending_returns = serializers.IntegerField(min_value=0)
    is_local_server = serializers.BooleanField()
    protocol = serializers.CharField()
    protocol_version = serializers.IntegerField(min_value=1)


class SyncOperationResultSerializer(serializers.Serializer):
    """Document the union of successful, partial and failed sync results."""

    status = serializers.CharField()
    code = serializers.CharField(required=False)
    message = serializers.CharField(required=False)
    details = serializers.JSONField(required=False)
    synced_sales = serializers.IntegerField(required=False, min_value=0)
    acknowledged_returns = serializers.IntegerField(required=False, min_value=0)
    synced_terminal_returns = serializers.IntegerField(required=False, min_value=0)
    synced_stock_updates = serializers.IntegerField(required=False, min_value=0)
    imported_categories = serializers.IntegerField(required=False, min_value=0)
    imported_suppliers = serializers.IntegerField(required=False, min_value=0)
    imported_products = serializers.IntegerField(required=False, min_value=0)
    rejected = serializers.ListField(
        child=serializers.DictField(),
        required=False,
    )
    missing_ack_ids = serializers.ListField(
        child=serializers.CharField(),
        required=False,
    )
    state_errors = serializers.ListField(
        child=serializers.CharField(),
        required=False,
    )
    transport_error = serializers.CharField(required=False, allow_blank=True)
    batches_completed = serializers.IntegerField(required=False, min_value=0)
    batches_total = serializers.IntegerField(required=False, min_value=0)
    records_submitted = serializers.IntegerField(required=False, min_value=0)


class FullSyncResponseSerializer(serializers.Serializer):
    push = SyncOperationResultSerializer()
    pull = SyncOperationResultSerializer()
    timestamp = serializers.DateTimeField()


class SyncErrorResponseSerializer(serializers.Serializer):
    error = serializers.CharField()


class SyncRecordError(ValueError):
    def __init__(self, message: str, code: str = 'invalid_record'):
        super().__init__(message)
        self.code = code


class SyncTokenPermission(BasePermission):
    """Require the configured shared token; no legacy header or default exists."""

    def has_permission(self, request, view):
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('SyncToken '):
            return False
        token = auth_header[len('SyncToken '):].strip()
        expected = getattr(settings, 'SYNC_TOKEN', None)
        if not expected or not token:
            return False
        return constant_time_compare(token, str(expected))


def _normalize_envelope(data: Any) -> tuple[dict[str, Any], str]:
    if not isinstance(data, dict):
        raise SyncRecordError('The request body must be a JSON object.', 'invalid_envelope')
    if data.get('protocol') != SYNC_PROTOCOL:
        raise SyncRecordError('Unsupported sync protocol.', 'unsupported_protocol')
    version = data.get('protocol_version')
    if (
        not isinstance(version, int)
        or isinstance(version, bool)
        or version != SYNC_PROTOCOL_VERSION
    ):
        raise SyncRecordError('Unsupported sync protocol version.', 'unsupported_version')
    try:
        origin_id = normalize_origin_id(data.get('origin_id'))
    except ValueError as exc:
        raise SyncRecordError(str(exc), 'invalid_origin') from exc
    _datetime_value(data, 'sent_at')

    total_records = 0
    for key in ('sales', 'returns', 'stock_updates'):
        value = data.get(key, [])
        if not isinstance(value, list):
            raise SyncRecordError(f'{key} must be a list.', 'invalid_envelope')
        total_records += len(value)
    if total_records > MAX_RECORDS_PER_BATCH:
        raise SyncRecordError('The synchronization batch is too large.', 'batch_too_large')
    return data, origin_id


def _field(data: dict[str, Any], name: str) -> Any:
    if name not in data:
        raise SyncRecordError(f'{name} is required.')
    return data[name]


def _string_value(
    data: dict[str, Any],
    name: str,
    *,
    required: bool = True,
    allow_blank: bool = False,
    max_length: int | None = None,
) -> str | None:
    value = _field(data, name) if required else data.get(name)
    if value is None and not required:
        return None
    if not isinstance(value, str):
        raise SyncRecordError(f'{name} must be a string.')
    value = value.strip()
    if not value and not allow_blank:
        raise SyncRecordError(f'{name} cannot be blank.')
    if max_length is not None and len(value) > max_length:
        raise SyncRecordError(f'{name} exceeds {max_length} characters.')
    return value


def _decimal_value(
    data: dict[str, Any],
    name: str,
    *,
    default: Decimal | None = None,
    nonnegative: bool = True,
) -> Decimal:
    value = data.get(name, default)
    if value is None:
        raise SyncRecordError(f'{name} is required.')
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError) as exc:
        raise SyncRecordError(f'{name} must be a decimal number.') from exc
    if not parsed.is_finite() or (nonnegative and parsed < 0):
        raise SyncRecordError(f'{name} must be a non-negative finite number.')
    return parsed


def _integer_value(
    data: dict[str, Any],
    name: str,
    *,
    minimum: int = 0,
) -> int:
    value = _field(data, name)
    if isinstance(value, bool):
        raise SyncRecordError(f'{name} must be an integer.')
    try:
        parsed = int(str(value))
    except (ValueError, TypeError) as exc:
        raise SyncRecordError(f'{name} must be an integer.') from exc
    if str(parsed) != str(value).strip() and not isinstance(value, int):
        raise SyncRecordError(f'{name} must be an integer.')
    if parsed < minimum:
        raise SyncRecordError(f'{name} must be at least {minimum}.')
    return parsed


def _boolean_value(data: dict[str, Any], name: str, *, default: bool = False) -> bool:
    value = data.get(name, default)
    if not isinstance(value, bool):
        raise SyncRecordError(f'{name} must be a boolean.')
    return value


def _datetime_value(
    data: dict[str, Any],
    name: str,
    *,
    required: bool = True,
) -> Any:
    value = _field(data, name) if required else data.get(name)
    if value is None and not required:
        return None
    if not isinstance(value, str):
        raise SyncRecordError(f'{name} must be an ISO-8601 timestamp.')
    parsed = parse_datetime(value)
    if parsed is None:
        raise SyncRecordError(f'{name} must be an ISO-8601 timestamp.')
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed, timezone.get_default_timezone())
    return parsed


def _local_identity(data: dict[str, Any], origin_id: str, record_type: str) -> tuple[str, str]:
    try:
        local_id = normalize_local_id(_field(data, 'local_id'))
        expected_sync_id = make_sync_id(origin_id, record_type, local_id)
    except ValueError as exc:
        raise SyncRecordError(str(exc), 'invalid_identity') from exc
    if data.get('sync_id') != expected_sync_id:
        raise SyncRecordError(
            f'sync_id must be {expected_sync_id}.',
            'invalid_identity',
        )
    return local_id, expected_sync_id


def _validate_sale(data: Any, origin_id: str) -> dict[str, Any]:
    if not isinstance(data, dict):
        raise SyncRecordError('A sale record must be an object.')
    local_id, sync_id = _local_identity(data, origin_id, 'sale')
    payment_method = _string_value(data, 'payment_method', max_length=10)
    if payment_method not in Sale.PaymentMethod.values:
        raise SyncRecordError('payment_method is invalid.')
    raw_items = _field(data, 'items')
    if not isinstance(raw_items, list) or not raw_items:
        raise SyncRecordError('items must be a non-empty list.')
    if len(raw_items) > MAX_ITEMS_PER_RECORD:
        raise SyncRecordError('A sale contains too many items.')

    items = []
    for expected_index, raw_item in enumerate(raw_items):
        if not isinstance(raw_item, dict):
            raise SyncRecordError('Each sale item must be an object.')
        line_index = _integer_value(raw_item, 'line_index', minimum=0)
        if line_index != expected_index:
            raise SyncRecordError('Sale line_index values must be contiguous and ordered.')
        barcode = _string_value(
            raw_item,
            'product_barcode',
            required=False,
            max_length=50,
        )
        items.append({
            'line_index': line_index,
            'product_barcode': barcode,
            'product_name': _string_value(raw_item, 'product_name', max_length=200),
            'quantity': _integer_value(raw_item, 'quantity', minimum=1),
            'unit_price_ht': _decimal_value(raw_item, 'unit_price_ht'),
            'total_price_ht': _decimal_value(raw_item, 'total_price_ht'),
            'tva_rate': _decimal_value(raw_item, 'tva_rate'),
            'unit_purchase_price': _decimal_value(raw_item, 'unit_purchase_price'),
            'total_purchase_cost': _decimal_value(raw_item, 'total_purchase_cost'),
        })

    validated = {
        'local_id': local_id,
        'sync_id': sync_id,
        'total_ht': _decimal_value(data, 'total_ht'),
        'total_tva': _decimal_value(data, 'total_tva'),
        'total_ttc': _decimal_value(data, 'total_ttc'),
        'discount_amount': _decimal_value(data, 'discount_amount', default=Decimal('0')),
        'discount_code': (
            _string_value(
                data,
                'discount_code',
                required=False,
                allow_blank=True,
                max_length=50,
            )
            or ''
        ),
        'amount_received': _decimal_value(data, 'amount_received', default=Decimal('0')),
        'change_amount': _decimal_value(data, 'change_amount', default=Decimal('0')),
        'idempotency_payload_hash': (
            _string_value(
                data,
                'idempotency_payload_hash',
                required=False,
                allow_blank=True,
                max_length=64,
            )
            or ''
        ),
        'payment_method': payment_method,
        'created_at': _datetime_value(data, 'created_at'),
        'updated_at': _datetime_value(data, 'updated_at'),
        'user_username': _string_value(
            data,
            'user_username',
            required=False,
            max_length=150,
        ),
        'items': items,
    }
    cent = Decimal('0.01')
    gross_ht = Decimal('0.00')
    gross_tva = Decimal('0.00')
    for item in items:
        expected_line = (
            item['unit_price_ht'] * item['quantity']
        ).quantize(cent, rounding=ROUND_HALF_UP)
        if item['total_price_ht'] != expected_line:
            raise SyncRecordError(
                'A sale item total does not match unit price × quantity.',
                'inconsistent_totals',
            )
        expected_cost = (
            item['unit_purchase_price'] * item['quantity']
        ).quantize(cent, rounding=ROUND_HALF_UP)
        if item['total_purchase_cost'] != expected_cost:
            raise SyncRecordError(
                'A sale item purchase cost is inconsistent.',
                'inconsistent_totals',
            )
        gross_ht += item['total_price_ht']
        gross_tva += (
            item['total_price_ht'] * item['tva_rate'] / Decimal('100')
        )
    gross_ht = gross_ht.quantize(cent, rounding=ROUND_HALF_UP)
    gross_tva = gross_tva.quantize(cent, rounding=ROUND_HALF_UP)
    gross_ttc = (gross_ht + gross_tva).quantize(cent, rounding=ROUND_HALF_UP)
    if (validated['total_ht'] + validated['total_tva']).quantize(
        cent, rounding=ROUND_HALF_UP
    ) != validated['total_ttc']:
        raise SyncRecordError(
            'Sale HT, VAT and TTC totals are inconsistent.',
            'inconsistent_totals',
        )
    if (validated['total_ttc'] + validated['discount_amount']).quantize(
        cent, rounding=ROUND_HALF_UP
    ) != gross_ttc:
        raise SyncRecordError(
            'Sale discount does not reconcile with its item totals.',
            'inconsistent_totals',
        )
    if payment_method == Sale.PaymentMethod.CASH:
        if (
            validated['amount_received'] - validated['change_amount']
        ).quantize(cent, rounding=ROUND_HALF_UP) != validated['total_ttc']:
            raise SyncRecordError(
                'Cash received and change do not reconcile with the total.',
                'inconsistent_payment',
            )
    elif (
        validated['amount_received'] != validated['total_ttc']
        or validated['change_amount'] != Decimal('0')
    ):
        raise SyncRecordError(
            'Non-cash payment must exactly match the sale total.',
            'inconsistent_payment',
        )
    return validated


def _sale_matches(existing: Sale, validated: dict[str, Any]) -> bool:
    scalar_fields = (
        'total_ht', 'total_tva', 'total_ttc', 'discount_amount', 'discount_code',
        'amount_received', 'change_amount', 'idempotency_payload_hash',
        'payment_method',
    )
    if any(getattr(existing, field) != validated[field] for field in scalar_fields):
        return False
    existing_items = list(existing.items.order_by('id'))
    if len(existing_items) != len(validated['items']):
        return False
    item_fields = (
        'product_name', 'quantity', 'unit_price_ht', 'total_price_ht',
        'tva_rate', 'unit_purchase_price', 'total_purchase_cost',
    )
    return all(
        all(getattr(existing_item, field) == incoming_item[field] for field in item_fields)
        for existing_item, incoming_item in zip(existing_items, validated['items'])
    )


def _import_sale(data: Any, origin_id: str) -> tuple[str, dict[str, Any]]:
    validated = _validate_sale(data, origin_id)
    existing = Sale.objects.select_for_update().filter(
        local_sync_id=validated['sync_id']
    ).first()
    if existing:
        if not _sale_matches(existing, validated):
            raise SyncRecordError(
                'The sync_id already exists with different sale data.',
                'idempotency_conflict',
            )
        return 'duplicate', validated

    from core.models import User

    user = None
    if validated['user_username']:
        user = User.objects.filter(username=validated['user_username']).first()
    sale = Sale.objects.create(
        user=user,
        total_ht=validated['total_ht'],
        total_tva=validated['total_tva'],
        total_ttc=validated['total_ttc'],
        discount_amount=validated['discount_amount'],
        discount_code=validated['discount_code'],
        amount_received=validated['amount_received'],
        change_amount=validated['change_amount'],
        idempotency_payload_hash=validated['idempotency_payload_hash'],
        payment_method=validated['payment_method'],
        synced=True,
        local_sync_id=validated['sync_id'],
    )
    Sale.objects.filter(pk=sale.pk).update(
        created_at=validated['created_at'],
        updated_at=validated['updated_at'],
    )
    for item in validated['items']:
        product = None
        if item['product_barcode']:
            product = Product.objects.filter(barcode=item['product_barcode']).first()
        SaleItem.objects.create(
            sale=sale,
            product=product,
            product_name=item['product_name'],
            quantity=item['quantity'],
            unit_price_ht=item['unit_price_ht'],
            total_price_ht=item['total_price_ht'],
            tva_rate=item['tva_rate'],
            unit_purchase_price=item['unit_purchase_price'],
            total_purchase_cost=item['total_purchase_cost'],
        )
    return 'created', validated


def _validate_return(data: Any, origin_id: str) -> dict[str, Any]:
    if not isinstance(data, dict):
        raise SyncRecordError('A return record must be an object.')
    local_id, sync_id = _local_identity(data, origin_id, 'return')
    try:
        sale_local_id = normalize_local_id(_field(data, 'sale_local_id'))
        expected_sale_sync_id = make_sync_id(origin_id, 'sale', sale_local_id)
    except ValueError as exc:
        raise SyncRecordError(str(exc), 'invalid_identity') from exc
    if data.get('sale_sync_id') != expected_sale_sync_id:
        raise SyncRecordError(
            f'sale_sync_id must be {expected_sale_sync_id}.',
            'invalid_identity',
        )
    return_status = _string_value(data, 'status', max_length=20)
    if return_status not in Return.ReturnStatus.values:
        raise SyncRecordError('status is invalid.')
    refund_method = _string_value(data, 'refund_method', required=False, max_length=10)
    refund_method = refund_method or Sale.PaymentMethod.CASH
    if refund_method not in Sale.PaymentMethod.values:
        raise SyncRecordError('refund_method is invalid.')

    raw_items = _field(data, 'items')
    if not isinstance(raw_items, list) or not raw_items:
        raise SyncRecordError('items must be a non-empty list.')
    if len(raw_items) > MAX_ITEMS_PER_RECORD:
        raise SyncRecordError('A return contains too many items.')
    items = []
    for raw_item in raw_items:
        if not isinstance(raw_item, dict):
            raise SyncRecordError('Each return item must be an object.')
        items.append({
            'sale_item_index': _integer_value(raw_item, 'sale_item_index', minimum=0),
            'product_barcode': _string_value(
                raw_item,
                'product_barcode',
                required=False,
                max_length=50,
            ),
            'product_name': _string_value(raw_item, 'product_name', max_length=200),
            'quantity': _integer_value(raw_item, 'quantity', minimum=1),
            'restock': _boolean_value(raw_item, 'restock', default=True),
        })

    return {
        'local_id': local_id,
        'sync_id': sync_id,
        'sale_local_id': sale_local_id,
        'sale_sync_id': expected_sale_sync_id,
        'reason': _string_value(data, 'reason'),
        'refund_amount': _decimal_value(data, 'refund_amount'),
        'refund_method': refund_method,
        'idempotency_payload_hash': (
            _string_value(
                data,
                'idempotency_payload_hash',
                required=False,
                allow_blank=True,
                max_length=64,
            )
            or ''
        ),
        'status': return_status,
        'created_at': _datetime_value(data, 'created_at'),
        'updated_at': _datetime_value(data, 'updated_at'),
        'stock_restored_at': _datetime_value(data, 'stock_restored_at', required=False),
        'completed_at': _datetime_value(data, 'completed_at', required=False),
        'processed_by_username': _string_value(
            data,
            'processed_by_username',
            required=False,
            max_length=150,
        ),
        'items': items,
    }


def _resolve_return_items(
    sale: Sale,
    items: list[dict[str, Any]],
    *,
    exclude_return_id: int | None = None,
) -> list[tuple[SaleItem, int, bool]]:
    sale_items = list(sale.items.select_related('product').order_by('id'))
    returned_rows = ReturnItem.objects.filter(
        sale_item__in=sale_items,
    ).exclude(return_order__status=Return.ReturnStatus.REJECTED)
    if exclude_return_id is not None:
        returned_rows = returned_rows.exclude(return_order_id=exclude_return_id)
    already_returned = {
        row['sale_item_id']: row['total']
        for row in returned_rows.values('sale_item_id').annotate(
            total=Sum('quantity')
        )
    }
    quantities_by_index: dict[int, int] = {}
    resolved = []
    for item in items:
        index = item['sale_item_index']
        if index >= len(sale_items):
            raise SyncRecordError('sale_item_index does not exist on the linked sale.')
        sale_item = sale_items[index]
        if item['product_name'] != sale_item.product_name:
            raise SyncRecordError('Return item does not match the linked sale item.')
        if (
            item['product_barcode']
            and sale_item.product
            and item['product_barcode'] != sale_item.product.barcode
        ):
            raise SyncRecordError('Return item barcode does not match the linked sale item.')
        quantities_by_index[index] = quantities_by_index.get(index, 0) + item['quantity']
        if (
            quantities_by_index[index]
            + already_returned.get(sale_item.id, 0)
            > sale_item.quantity
        ):
            raise SyncRecordError('Returned quantity exceeds the linked sale item quantity.')
        resolved.append((sale_item, item['quantity'], item['restock']))
    return resolved


def _return_items_match(existing: Return, resolved: list[tuple[SaleItem, int, bool]]) -> bool:
    existing_items = list(existing.items.order_by('id'))
    if len(existing_items) != len(resolved):
        return False
    return all(
        item.sale_item_id == sale_item.id
        and item.quantity == quantity
        and item.restock == restock
        for item, (sale_item, quantity, restock) in zip(existing_items, resolved)
    )


def _import_return(data: Any, origin_id: str) -> tuple[str, dict[str, Any]]:
    validated = _validate_return(data, origin_id)
    sale = Sale.objects.select_for_update().filter(
        local_sync_id=validated['sale_sync_id']
    ).first()
    if not sale:
        raise SyncRecordError('The linked sale has not been synchronized.', 'missing_sale')
    existing = Return.objects.select_for_update().filter(
        local_sync_id=validated['sync_id']
    ).first()
    resolved_items = _resolve_return_items(
        sale,
        validated['items'],
        exclude_return_id=existing.pk if existing else None,
    )

    sale_gross_ttc = sum(
        item.total_price_ht
        + (item.total_price_ht * item.tva_rate / Decimal('100'))
        for item in sale.items.all()
    )
    refund_ratio = Decimal('1')
    if sale_gross_ttc > 0 and sale.total_ttc < sale_gross_ttc:
        refund_ratio = sale.total_ttc / sale_gross_ttc
    expected_refund = sum(
        (
            sale_item.unit_price_ht
            * (Decimal('1') + sale_item.tva_rate / Decimal('100'))
            * quantity
            * refund_ratio
        )
        for sale_item, quantity, _restock in resolved_items
    ).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    if validated['refund_amount'] != expected_refund:
        raise SyncRecordError(
            'refund_amount does not match the returned sale lines.',
            'inconsistent_refund',
        )

    from core.models import User

    processed_by = None
    if validated['processed_by_username']:
        processed_by = User.objects.filter(
            username=validated['processed_by_username']
        ).first()
    if existing:
        if existing.sale_id != sale.id:
            raise SyncRecordError(
                'The sync_id already exists for another sale.',
                'idempotency_conflict',
            )
        current_status = existing.status
        incoming_status = validated['status']
        scalars_match = (
            existing.status == incoming_status
            and existing.reason == validated['reason']
            and existing.refund_amount == validated['refund_amount']
            and existing.refund_method == validated['refund_method']
            and (
                existing.idempotency_payload_hash
                == validated['idempotency_payload_hash']
            )
            and existing.processed_by_id == (processed_by.id if processed_by else None)
            and existing.stock_restored_at == validated['stock_restored_at']
            and existing.completed_at == validated['completed_at']
        )
        items_match = _return_items_match(existing, resolved_items)
        if current_status in TERMINAL_RETURN_STATUSES:
            if incoming_status == current_status and scalars_match and items_match:
                return 'duplicate', validated
            raise SyncRecordError(
                'A terminal return is immutable.',
                'idempotency_conflict',
            )
        if RETURN_STATUS_ORDER[incoming_status] < RETURN_STATUS_ORDER[current_status]:
            return 'unchanged', {**validated, 'status': current_status}
        if scalars_match and items_match:
            return 'duplicate', validated

        Return.objects.filter(pk=existing.pk).update(
            status=incoming_status,
            reason=validated['reason'],
            refund_amount=validated['refund_amount'],
            refund_method=validated['refund_method'],
            idempotency_payload_hash=validated['idempotency_payload_hash'],
            processed_by=processed_by,
            stock_restored_at=validated['stock_restored_at'],
            completed_at=validated['completed_at'],
            updated_at=validated['updated_at'],
            synced=True,
        )
        existing.items.all().delete()
        ReturnItem.objects.bulk_create([
            ReturnItem(
                return_order=existing,
                sale_item=sale_item,
                quantity=quantity,
                restock=restock,
            )
            for sale_item, quantity, restock in resolved_items
        ])
        return 'updated', validated

    return_order = Return.objects.create(
        sale=sale,
        status=validated['status'],
        reason=validated['reason'],
        refund_amount=validated['refund_amount'],
        refund_method=validated['refund_method'],
        idempotency_payload_hash=validated['idempotency_payload_hash'],
        processed_by=processed_by,
        stock_restored_at=validated['stock_restored_at'],
        completed_at=validated['completed_at'],
        synced=True,
        local_sync_id=validated['sync_id'],
    )
    Return.objects.filter(pk=return_order.pk).update(
        created_at=validated['created_at'],
        updated_at=validated['updated_at'],
    )
    ReturnItem.objects.bulk_create([
        ReturnItem(
            return_order=return_order,
            sale_item=sale_item,
            quantity=quantity,
            restock=restock,
        )
        for sale_item, quantity, restock in resolved_items
    ])
    return 'created', validated


def _import_stock_update(data: Any, origin_id: str) -> tuple[str, dict[str, Any]]:
    if not isinstance(data, dict):
        raise SyncRecordError('A stock update must be an object.')
    barcode = _string_value(data, 'barcode', max_length=50)
    expected_sync_id = make_stock_sync_id(origin_id, barcode)
    if data.get('sync_id') != expected_sync_id:
        raise SyncRecordError(
            f'sync_id must be {expected_sync_id}.',
            'invalid_identity',
        )
    stock = _integer_value(data, 'stock', minimum=0)
    source_updated_at = _datetime_value(data, 'updated_at')
    product = Product.objects.select_for_update().filter(
        barcode=barcode
    ).only('id', 'stock').first()
    if not product:
        raise SyncRecordError('Product does not exist on the cloud.', 'missing_product')

    snapshot = SyncStockSnapshot.objects.select_for_update().filter(
        origin_id=origin_id,
        product=product,
    ).first()
    if snapshot and source_updated_at < snapshot.source_updated_at:
        return 'stale', {
            'sync_id': expected_sync_id,
            'barcode': barcode,
        }
    if snapshot and source_updated_at == snapshot.source_updated_at:
        if snapshot.stock != stock:
            raise SyncRecordError(
                'The same stock version already exists with different data.',
                'idempotency_conflict',
            )
        outcome = 'duplicate'
    elif snapshot:
        snapshot.stock = stock
        snapshot.source_updated_at = source_updated_at
        snapshot.save(update_fields=['stock', 'source_updated_at', 'updated_at'])
        outcome = 'applied'
    else:
        SyncStockSnapshot.objects.create(
            origin_id=origin_id,
            product=product,
            stock=stock,
            source_updated_at=source_updated_at,
        )
        outcome = 'applied'

    aggregate_stock = SyncStockSnapshot.objects.filter(
        product=product
    ).aggregate(total=Sum('stock'))['total'] or 0
    if product.stock != aggregate_stock:
        # Keep master-data timestamps independent from transactional stock.
        Product.objects.filter(pk=product.pk).update(stock=aggregate_stock)
        product.stock = aggregate_stock
        ProductCostLayer.reconcile_to_stock(
            product,
            note='Agrégation des stocks synchronisés par origine',
        )
        ProductCostLayer.assert_matches_stock(product)
    return outcome, {'sync_id': expected_sync_id, 'barcode': barcode}


def _acknowledge(records, importer, origin_id: str, record_type: str) -> list[dict[str, Any]]:
    acknowledgements = []
    for record in records:
        fallback_sync_id = record.get('sync_id') if isinstance(record, dict) else None
        fallback_local_id = record.get('local_id') if isinstance(record, dict) else None
        try:
            with transaction.atomic():
                outcome, validated = importer(record, origin_id)
            ack = {
                'sync_id': validated['sync_id'],
                'status': outcome,
            }
            if validated.get('local_id') is not None:
                ack['local_id'] = validated['local_id']
            if record_type == 'return':
                ack['record_status'] = validated['status']
            acknowledgements.append(ack)
        except SyncRecordError as exc:
            acknowledgements.append({
                'sync_id': fallback_sync_id,
                'local_id': fallback_local_id,
                'status': 'rejected',
                'error_code': exc.code,
                'error': str(exc),
            })
        except Exception:
            logger.exception('Unexpected failure while importing a %s record', record_type)
            acknowledgements.append({
                'sync_id': fallback_sync_id,
                'local_id': fallback_local_id,
                'status': 'rejected',
                'error_code': 'internal_error',
                'error': 'The cloud could not import this record.',
            })
    return acknowledgements


@api_view(['POST'])
@permission_classes([SyncTokenPermission])
def receive_sync_data(request):
    """Receive one v1 batch and return one explicit ACK per submitted record."""
    try:
        data, origin_id = _normalize_envelope(request.data)
    except SyncRecordError as exc:
        return Response(
            {
                'protocol': SYNC_PROTOCOL,
                'protocol_version': SYNC_PROTOCOL_VERSION,
                'status': 'error',
                'error_code': exc.code,
                'detail': str(exc),
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    acknowledgements = {
        'sales': _acknowledge(data.get('sales', []), _import_sale, origin_id, 'sale'),
        'returns': _acknowledge(data.get('returns', []), _import_return, origin_id, 'return'),
        'stock_updates': _acknowledge(
            data.get('stock_updates', []),
            _import_stock_update,
            origin_id,
            'stock_update',
        ),
    }
    all_acks = [ack for values in acknowledgements.values() for ack in values]
    rejected_count = sum(ack['status'] == 'rejected' for ack in all_acks)
    return Response({
        'protocol': SYNC_PROTOCOL,
        'protocol_version': SYNC_PROTOCOL_VERSION,
        'origin_id': origin_id,
        'status': 'success' if rejected_count == 0 else 'partial',
        'acks': acknowledgements,
        'summary': {
            'received': len(all_acks),
            'acknowledged': len(all_acks) - rejected_count,
            'rejected': rejected_count,
        },
        'sync_time': timezone.now().isoformat(),
    })


def _credit_snapshot_records(data: Any) -> tuple[dict[str, Any], str]:
    """Validate the bounded, versioned envelope used by credit snapshots."""
    if not isinstance(data, dict):
        raise SyncRecordError('The request body must be a JSON object.', 'invalid_envelope')
    if data.get('protocol') != SYNC_PROTOCOL:
        raise SyncRecordError('Unsupported sync protocol.', 'unsupported_protocol')
    if data.get('protocol_version') != SYNC_PROTOCOL_VERSION:
        raise SyncRecordError('Unsupported sync protocol version.', 'unsupported_version')
    try:
        origin_id = normalize_origin_id(data.get('origin_id'))
    except ValueError as exc:
        raise SyncRecordError(str(exc), 'invalid_origin') from exc
    _datetime_value(data, 'snapshot_at')

    total_records = 0
    for key in ('customers', 'credit_sales', 'credit_payments'):
        records = data.get(key, [])
        if not isinstance(records, list):
            raise SyncRecordError(f'{key} must be a list.', 'invalid_envelope')
        total_records += len(records)
    if total_records > MAX_RECORDS_PER_BATCH:
        raise SyncRecordError('The credit snapshot is too large.', 'batch_too_large')
    return data, origin_id


@api_view(['POST'])
@permission_classes([SyncTokenPermission])
def receive_credits_snapshot(request):
    """Atomically replace the cloud read-only credit ledger for one shop."""
    try:
        data, origin_id = _credit_snapshot_records(request.data)
        from core.models import User
        from credit.models import CreditPayment, CreditSale, Customer

        customer_rows: list[dict[str, Any]] = []
        seen_customers: set[str] = set()
        for raw in data.get('customers', []):
            if not isinstance(raw, dict):
                raise SyncRecordError('A customer record must be an object.')
            try:
                local_id = normalize_local_id(_field(raw, 'local_id'))
            except ValueError as exc:
                raise SyncRecordError(str(exc), 'invalid_identity') from exc
            if local_id in seen_customers:
                raise SyncRecordError('Customer local_id values must be unique.', 'duplicate_identity')
            seen_customers.add(local_id)
            customer_rows.append({
                'local_id': local_id,
                'name': _string_value(raw, 'name', max_length=200),
                'phone': _string_value(
                    raw, 'phone', required=False, allow_blank=True, max_length=30,
                ) or '',
                'note': _string_value(
                    raw, 'note', required=False, allow_blank=True, max_length=200,
                ) or '',
                'created_at': _datetime_value(raw, 'created_at'),
            })

        credit_sale_rows: list[dict[str, Any]] = []
        seen_credit_sales: set[str] = set()
        sale_prefix = f'{origin_id}:sale:'
        for raw in data.get('credit_sales', []):
            if not isinstance(raw, dict):
                raise SyncRecordError('A credit sale record must be an object.')
            try:
                local_id = normalize_local_id(_field(raw, 'local_id'))
                customer_local_id = normalize_local_id(_field(raw, 'customer_local_id'))
            except ValueError as exc:
                raise SyncRecordError(str(exc), 'invalid_identity') from exc
            if local_id in seen_credit_sales:
                raise SyncRecordError('Credit-sale local_id values must be unique.', 'duplicate_identity')
            seen_credit_sales.add(local_id)
            sale_sync_id = _string_value(raw, 'sale_sync_id', max_length=64)
            if not sale_sync_id.startswith(sale_prefix):
                raise SyncRecordError('sale_sync_id does not belong to this origin.', 'invalid_identity')
            try:
                expected_sale_sync_id = make_sync_id(
                    origin_id, 'sale', sale_sync_id[len(sale_prefix):],
                )
            except ValueError as exc:
                raise SyncRecordError(str(exc), 'invalid_identity') from exc
            if sale_sync_id != expected_sale_sync_id:
                raise SyncRecordError('sale_sync_id is invalid.', 'invalid_identity')
            credit_status = _string_value(raw, 'status', max_length=10)
            if credit_status not in CreditSale.Status.values:
                raise SyncRecordError('Credit sale status is invalid.')
            credit_sale_rows.append({
                'local_id': local_id,
                'customer_local_id': customer_local_id,
                'sale_sync_id': sale_sync_id,
                'status': credit_status,
                'paid_amount': _decimal_value(raw, 'paid_amount'),
                'created_at': _datetime_value(raw, 'created_at'),
            })

        payment_rows: list[dict[str, Any]] = []
        seen_payments: set[str] = set()
        for raw in data.get('credit_payments', []):
            if not isinstance(raw, dict):
                raise SyncRecordError('A credit payment record must be an object.')
            try:
                local_id = normalize_local_id(_field(raw, 'local_id'))
                credit_sale_local_id = normalize_local_id(
                    _field(raw, 'credit_sale_local_id'),
                )
            except ValueError as exc:
                raise SyncRecordError(str(exc), 'invalid_identity') from exc
            if local_id in seen_payments:
                raise SyncRecordError('Payment local_id values must be unique.', 'duplicate_identity')
            seen_payments.add(local_id)
            amount = _decimal_value(raw, 'amount')
            if amount <= 0:
                raise SyncRecordError('Payment amount must be greater than zero.')
            payment_rows.append({
                'local_id': local_id,
                'credit_sale_local_id': credit_sale_local_id,
                'amount': amount,
                'note': _string_value(
                    raw, 'note', required=False, allow_blank=True, max_length=200,
                ) or '',
                'created_by_username': _string_value(
                    raw, 'created_by_username', required=False, max_length=150,
                ),
                'created_at': _datetime_value(raw, 'created_at'),
            })

        skipped_credit_sales = 0
        skipped_payments = 0
        with transaction.atomic():
            CreditPayment.objects.all().delete()
            CreditSale.objects.all().delete()
            Customer.objects.all().delete()

            customer_ids: dict[str, int] = {}
            for row in customer_rows:
                customer = Customer.objects.create(
                    name=row['name'], phone=row['phone'], note=row['note'],
                )
                Customer.objects.filter(pk=customer.pk).update(
                    created_at=row['created_at'], updated_at=row['created_at'],
                )
                customer_ids[row['local_id']] = customer.pk

            credit_sale_ids: dict[str, int] = {}
            for row in credit_sale_rows:
                customer_id = customer_ids.get(row['customer_local_id'])
                sale = Sale.objects.filter(local_sync_id=row['sale_sync_id']).first()
                if customer_id is None or sale is None:
                    skipped_credit_sales += 1
                    continue
                credit_sale = CreditSale.objects.create(
                    sale=sale,
                    customer_id=customer_id,
                    status=row['status'],
                    paid_amount=row['paid_amount'],
                )
                CreditSale.objects.filter(pk=credit_sale.pk).update(
                    created_at=row['created_at'], updated_at=row['created_at'],
                )
                credit_sale_ids[row['local_id']] = credit_sale.pk

            usernames = {
                row['created_by_username'] for row in payment_rows
                if row['created_by_username']
            }
            users_by_name = {
                user.username: user
                for user in User.objects.filter(username__in=usernames)
            }
            for row in payment_rows:
                credit_sale_id = credit_sale_ids.get(row['credit_sale_local_id'])
                if credit_sale_id is None:
                    skipped_payments += 1
                    continue
                payment = CreditPayment.objects.create(
                    credit_sale_id=credit_sale_id,
                    amount=row['amount'],
                    note=row['note'],
                    created_by=users_by_name.get(row['created_by_username']),
                )
                CreditPayment.objects.filter(pk=payment.pk).update(
                    created_at=row['created_at'],
                )

        return Response({
            'protocol': SYNC_PROTOCOL,
            'protocol_version': SYNC_PROTOCOL_VERSION,
            'origin_id': origin_id,
            'status': 'success',
            'customers_imported': len(customer_rows),
            'credit_sales_imported': len(credit_sale_rows) - skipped_credit_sales,
            'credit_sales_skipped': skipped_credit_sales,
            'credit_payments_imported': len(payment_rows) - skipped_payments,
            'credit_payments_skipped': skipped_payments,
            'received_at': timezone.now().isoformat(),
        })
    except SyncRecordError as exc:
        return Response(
            {
                'protocol': SYNC_PROTOCOL,
                'protocol_version': SYNC_PROTOCOL_VERSION,
                'status': 'error',
                'error_code': exc.code,
                'detail': str(exc),
            },
            status=status.HTTP_400_BAD_REQUEST,
        )
    except Exception:
        logger.exception('Credit snapshot import failed')
        return Response(
            {'detail': 'The cloud could not import the credit snapshot.'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


@api_view(['GET'])
@permission_classes([SyncTokenPermission])
def get_master_data(request):
    """Return cloud-owned master data using the same protocol version."""
    if request.query_params.get('protocol_version') != str(SYNC_PROTOCOL_VERSION):
        return Response(
            {'detail': 'Unsupported sync protocol version.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    try:
        origin_id = normalize_origin_id(request.query_params.get('origin_id'))
    except ValueError:
        return Response(
            {'detail': 'origin_id must be a valid UUID'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    snapshot_at = timezone.now()
    products_qs = Product.objects.filter(updated_at__lte=snapshot_at)
    since = request.query_params.get('since')
    if since:
        since_dt = parse_datetime(since)
        if since_dt is None:
            return Response(
                {'detail': 'since must be an ISO-8601 timestamp.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if timezone.is_naive(since_dt):
            since_dt = timezone.make_aware(since_dt, timezone.get_default_timezone())
        products_qs = products_qs.filter(updated_at__gt=since_dt)

    categories = list(Category.objects.all().values(
        'name', 'description', 'icon', 'color'
    ))
    suppliers = list(Supplier.objects.all().values(
        'name', 'contact_name', 'email', 'phone', 'address', 'notes', 'active'
    ))
    products = [
        {
            'barcode': product.barcode,
            'name': product.name,
            'description': product.description,
            'category_name': product.category.name if product.category else None,
            'supplier_name': product.supplier.name if product.supplier else None,
            'purchase_price': str(product.purchase_price),
            'sale_price_ht': str(product.sale_price_ht),
            'tva': str(product.tva),
            'stock': product.stock,
            'min_stock': product.min_stock,
            'active': product.active,
            'updated_at': product.updated_at.isoformat(),
        }
        for product in products_qs.select_related('category', 'supplier')
    ]
    return Response({
        'protocol': SYNC_PROTOCOL,
        'protocol_version': SYNC_PROTOCOL_VERSION,
        'origin_id': origin_id,
        'categories': categories,
        'suppliers': suppliers,
        'products': products,
        'timestamp': snapshot_at.isoformat(),
    })


@extend_schema(
    request=None,
    responses={200: SyncStatusResponseSerializer},
)
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def sync_status(request):
    """Expose actual pending counts and the last durable sync cursor."""
    from core.sync_service import sync_service

    last_sync = sync_service.get_last_sync_time()
    return Response({
        'cloud_configured': bool(
            getattr(settings, 'CLOUD_API_URL', None)
            and getattr(settings, 'SYNC_TOKEN', None)
        ),
        'last_sync': last_sync.isoformat() if last_sync else None,
        'pending_sales': Sale.objects.filter(synced=False).count(),
        'pending_returns': Return.objects.filter(synced=False).count(),
        'is_local_server': not getattr(settings, 'IS_CLOUD_SERVER', False),
        'protocol': SYNC_PROTOCOL,
        'protocol_version': SYNC_PROTOCOL_VERSION,
    })


@extend_schema(
    request=None,
    responses={
        200: FullSyncResponseSerializer,
        403: OpenApiResponse(
            response=SyncErrorResponseSerializer,
            description='Synchronisation réservée aux administrateurs.',
        ),
    },
)
@api_view(['POST'])
@permission_classes([IsAuthenticated])
def trigger_sync(request):
    """Run a synchronous bidirectional sync for administrators."""
    if request.user.role != 'ADMIN':
        return Response({'error': 'Admin only'}, status=status.HTTP_403_FORBIDDEN)
    from core.sync_service import sync_service

    return Response(sync_service.full_sync())
