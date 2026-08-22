"""Canonical local-to-cloud synchronization client.

The wire contract in this module is shared with :mod:`core.sync_api`.  Sales
and returns are identified by ``<origin UUID>:<kind>:<local id>`` and are only
marked as synchronized after the cloud explicitly acknowledges that exact id.
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

import requests
from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from core.models import SyncLog
from inventory.models import (
    Category,
    PriceHistory,
    Product,
    ProductCostLayer,
    Supplier,
)
from sales.models import Return, Sale

logger = logging.getLogger(__name__)

SYNC_PROTOCOL = 'libtak-sync'
SYNC_PROTOCOL_VERSION = 1
MAX_RECORDS_PER_BATCH = 10_000
ACKNOWLEDGED_STATUSES = frozenset({
    'created', 'duplicate', 'updated', 'applied', 'unchanged', 'stale',
})
TERMINAL_RETURN_STATUSES = frozenset({Return.ReturnStatus.COMPLETED, Return.ReturnStatus.REJECTED})


class SyncConfigurationError(RuntimeError):
    """Raised when synchronization is requested without safe configuration."""


class SyncProtocolError(RuntimeError):
    """Raised when the remote endpoint does not honor the sync contract."""


def normalize_origin_id(value: Any) -> str:
    """Return a canonical UUID string or raise a protocol/configuration error."""
    try:
        return str(uuid.UUID(str(value)))
    except (ValueError, TypeError, AttributeError) as exc:
        raise ValueError('origin_id must be a valid UUID') from exc


def normalize_local_id(value: Any) -> str:
    """Normalize a positive integer primary key for a wire identifier."""
    if isinstance(value, bool):
        raise ValueError('local_id must be a positive integer')
    try:
        integer = int(str(value))
    except (ValueError, TypeError) as exc:
        raise ValueError('local_id must be a positive integer') from exc
    if integer <= 0:
        raise ValueError('local_id must be a positive integer')
    return str(integer)


def make_sync_id(origin_id: Any, record_type: str, local_id: Any) -> str:
    """Build the idempotency id stored in ``local_sync_id`` on the cloud."""
    origin = normalize_origin_id(origin_id)
    if record_type not in {'sale', 'return'}:
        raise ValueError('record_type must be sale or return')
    normalized_local_id = normalize_local_id(local_id)
    sync_id = f'{origin}:{record_type}:{normalized_local_id}'
    if len(sync_id) > 64:
        raise ValueError('sync id exceeds the database limit')
    return sync_id


def make_stock_sync_id(origin_id: Any, barcode: Any) -> str:
    """Build a stable, compact id for a stock snapshot acknowledgement."""
    origin = normalize_origin_id(origin_id)
    normalized_barcode = str(barcode or '').strip()
    if not normalized_barcode:
        raise ValueError('barcode is required')
    digest = uuid.uuid5(uuid.UUID(origin), f'stock:{normalized_barcode}').hex[:16]
    return f'{origin}:stock:{digest}'


def _parse_state_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    parsed = parse_datetime(str(value))
    if parsed is None:
        return None
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed, timezone.get_default_timezone())
    return parsed


class SyncService:
    """Push transactional data and pull cloud-owned master data."""

    def __init__(
        self,
        *,
        cloud_url: str | None = None,
        sync_token: str | None = None,
        origin_id: str | None = None,
        state_file: str | Path | None = None,
        origin_file: str | Path | None = None,
        http_client: Any = None,
    ):
        self.cloud_url = (
            cloud_url if cloud_url is not None else getattr(settings, 'CLOUD_API_URL', '')
        ).strip()
        self.sync_token = (
            sync_token if sync_token is not None else getattr(settings, 'SYNC_TOKEN', None)
        )
        configured_origin = origin_id or getattr(settings, 'SYNC_ORIGIN_ID', None)
        self.configured_origin_id = configured_origin or os.environ.get('SYNC_ORIGIN_ID')
        configured_state_file = state_file or os.environ.get('SYNC_STATE_FILE')
        self.state_file = Path(configured_state_file or (settings.BASE_DIR / '.sync_state.local'))
        configured_origin_file = origin_file or os.environ.get('SYNC_ORIGIN_FILE')
        self.origin_file = Path(
            configured_origin_file or (settings.BASE_DIR / '.sync_origin.local')
        )
        self.legacy_last_sync_file = Path(settings.BASE_DIR) / '.last_sync'
        self.http_client = http_client or requests

    def _read_state(self) -> dict[str, Any]:
        if self.state_file.exists():
            try:
                state = json.loads(self.state_file.read_text(encoding='utf-8'))
                if isinstance(state, dict):
                    return state
            except (OSError, ValueError, TypeError) as exc:
                logger.warning('Could not read sync state: %s', exc)

        # One-time compatibility with the previous single timestamp file.
        if self.legacy_last_sync_file.exists():
            try:
                legacy_timestamp = self.legacy_last_sync_file.read_text(encoding='utf-8').strip()
                if _parse_state_datetime(legacy_timestamp):
                    return {
                        'last_push_at': legacy_timestamp,
                        'last_pull_at': legacy_timestamp,
                    }
            except OSError as exc:
                logger.warning('Could not read legacy sync state: %s', exc)
        return {}

    def _write_state(self, state: dict[str, Any]) -> None:
        try:
            self.state_file.parent.mkdir(parents=True, exist_ok=True)
            temporary = self.state_file.with_suffix(self.state_file.suffix + '.tmp')
            temporary.write_text(
                json.dumps(state, ensure_ascii=False, indent=2, sort_keys=True),
                encoding='utf-8',
            )
            temporary.replace(self.state_file)
        except OSError as exc:
            raise SyncConfigurationError(
                'Cannot persist sync state; configure SYNC_STATE_FILE or SYNC_ORIGIN_ID.'
            ) from exc

    def get_origin_id(self) -> str:
        """Return the configured origin UUID, creating one persistent UUID if needed."""
        if self.configured_origin_id:
            try:
                return normalize_origin_id(self.configured_origin_id)
            except ValueError as exc:
                raise SyncConfigurationError('SYNC_ORIGIN_ID must be a valid UUID.') from exc

        if self.origin_file.exists():
            try:
                return normalize_origin_id(
                    self.origin_file.read_text(encoding='utf-8').strip()
                )
            except (OSError, ValueError) as exc:
                raise SyncConfigurationError(
                    'The persisted sync origin is invalid; configure SYNC_ORIGIN_ID.'
                ) from exc

        state = self._read_state()
        candidate = state.get('origin_id') or str(uuid.uuid4())
        try:
            candidate = normalize_origin_id(candidate)
        except ValueError as exc:
            raise SyncConfigurationError(
                'The persisted sync origin is invalid; configure SYNC_ORIGIN_ID.'
            ) from exc

        # Exclusive creation ensures two scheduler processes starting for the
        # first time cannot assign different origins and duplicate cloud data.
        try:
            self.origin_file.parent.mkdir(parents=True, exist_ok=True)
            descriptor = os.open(
                self.origin_file,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL,
                0o600,
            )
            with os.fdopen(descriptor, 'w', encoding='utf-8') as origin_handle:
                origin_handle.write(f'{candidate}\n')
            return candidate
        except FileExistsError:
            try:
                return normalize_origin_id(
                    self.origin_file.read_text(encoding='utf-8').strip()
                )
            except (OSError, ValueError) as exc:
                raise SyncConfigurationError(
                    'The persisted sync origin is invalid; configure SYNC_ORIGIN_ID.'
                ) from exc
        except OSError as exc:
            raise SyncConfigurationError(
                'Cannot persist sync origin; configure SYNC_ORIGIN_ID or SYNC_ORIGIN_FILE.'
            ) from exc

    def _get_cursor(self, key: str) -> datetime | None:
        return _parse_state_datetime(self._read_state().get(key))

    def _set_cursor(self, key: str, timestamp: datetime) -> None:
        state = self._read_state()
        state.setdefault('origin_id', self.get_origin_id())
        state[key] = timestamp.isoformat()
        self._write_state(state)

    def get_last_sync_time(self) -> datetime | None:
        """Return the most recent successful push/pull timestamp for the UI."""
        timestamps = [
            self._get_cursor('last_push_at'),
            self._get_cursor('last_pull_at'),
        ]
        timestamps = [timestamp for timestamp in timestamps if timestamp is not None]
        return max(timestamps) if timestamps else None

    def set_last_sync_time(self, timestamp: datetime | None = None) -> None:
        """Compatibility helper: advance the push cursor."""
        self._set_cursor('last_push_at', timestamp or timezone.now())

    def _sync_base_url(self) -> str:
        base = self.cloud_url.rstrip('/')
        if base.endswith('/api/auth'):
            return base
        if base.endswith('/api'):
            return f'{base}/auth'
        return f'{base}/api/auth'

    def _endpoint(self, endpoint: str) -> str:
        return f'{self._sync_base_url()}/sync/{endpoint.strip("/")}/'

    def _require_configuration(self) -> str:
        if not self.cloud_url:
            raise SyncConfigurationError('Cloud sync not configured: CLOUD_API_URL is required.')
        if not self.sync_token or not str(self.sync_token).strip():
            raise SyncConfigurationError('Cloud sync not configured: SYNC_TOKEN is required.')
        return self.get_origin_id()

    def get_pending_sales(self, origin_id: str | None = None) -> list[dict[str, Any]]:
        """Serialize every unacknowledged sale, irrespective of an old cursor."""
        origin = origin_id or self.get_origin_id()
        sales = (
            Sale.objects.filter(synced=False)
            .select_related('user')
            .prefetch_related('items__product')
            .order_by('id')
        )
        return [self._serialize_sale(sale, origin) for sale in sales]

    def _serialize_sale(self, sale: Sale, origin_id: str | None = None) -> dict[str, Any]:
        origin = origin_id or self.get_origin_id()
        items = sorted(sale.items.all(), key=lambda item: item.id)
        return {
            'local_id': str(sale.id),
            'sync_id': make_sync_id(origin, 'sale', sale.id),
            'total_ht': str(sale.total_ht),
            'total_tva': str(sale.total_tva),
            'total_ttc': str(sale.total_ttc),
            'discount_amount': str(sale.discount_amount),
            'discount_code': sale.discount_code,
            'amount_received': str(sale.amount_received),
            'change_amount': str(sale.change_amount),
            'idempotency_payload_hash': sale.idempotency_payload_hash,
            'payment_method': sale.payment_method,
            'created_at': sale.created_at.isoformat(),
            'updated_at': sale.updated_at.isoformat(),
            'user_username': sale.user.username if sale.user else None,
            'items': [
                {
                    'line_index': index,
                    'local_id': str(item.id),
                    'product_barcode': item.product.barcode if item.product else None,
                    'product_name': item.product_name,
                    'quantity': item.quantity,
                    'unit_price_ht': str(item.unit_price_ht),
                    'total_price_ht': str(item.total_price_ht),
                    'tva_rate': str(item.tva_rate),
                    'unit_purchase_price': str(item.unit_purchase_price),
                    'total_purchase_cost': str(item.total_purchase_cost),
                }
                for index, item in enumerate(items)
            ],
        }

    def get_pending_returns(
        self,
        origin_id: str | None = None,
        *,
        until: datetime | None = None,
    ) -> list[dict[str, Any]]:
        """Serialize new returns and returns changed after their last ACK cursor."""
        origin = origin_id or self.get_origin_id()
        returns = Return.objects.all()
        cursor = (
            self._get_cursor('last_return_push_at')
            or self._get_cursor('last_push_at')
        )
        if cursor:
            returns = returns.filter(Q(synced=False) | Q(updated_at__gt=cursor))
        else:
            returns = returns.filter(synced=False)
        if until:
            returns = returns.filter(updated_at__lte=until)
        returns = (
            returns
            .select_related('sale', 'processed_by')
            .prefetch_related('items__sale_item__product', 'sale__items__product')
            .order_by('id')
        )
        return [self._serialize_return(return_order, origin) for return_order in returns]

    def _serialize_return(
        self,
        return_order: Return,
        origin_id: str | None = None,
    ) -> dict[str, Any]:
        origin = origin_id or self.get_origin_id()
        sale_items = sorted(return_order.sale.items.all(), key=lambda item: item.id)
        sale_item_indexes = {item.id: index for index, item in enumerate(sale_items)}
        return_items = sorted(return_order.items.all(), key=lambda item: item.id)
        return {
            'local_id': str(return_order.id),
            'sync_id': make_sync_id(origin, 'return', return_order.id),
            'sale_local_id': str(return_order.sale_id),
            'sale_sync_id': make_sync_id(origin, 'sale', return_order.sale_id),
            'reason': return_order.reason,
            'refund_amount': str(return_order.refund_amount),
            'cash_refund_amount': str(return_order.cash_refund_amount),
            'refund_method': return_order.refund_method,
            'idempotency_payload_hash': return_order.idempotency_payload_hash,
            'status': return_order.status,
            'created_at': return_order.created_at.isoformat(),
            'updated_at': return_order.updated_at.isoformat(),
            'stock_restored_at': (
                return_order.stock_restored_at.isoformat()
                if return_order.stock_restored_at else None
            ),
            'completed_at': (
                return_order.completed_at.isoformat() if return_order.completed_at else None
            ),
            'processed_by_username': (
                return_order.processed_by.username if return_order.processed_by else None
            ),
            'items': [
                {
                    'sale_item_index': sale_item_indexes[item.sale_item_id],
                    'sale_item_local_id': str(item.sale_item_id),
                    'product_barcode': (
                        item.sale_item.product.barcode if item.sale_item.product else None
                    ),
                    'product_name': item.sale_item.product_name,
                    'quantity': item.quantity,
                    'restock': item.restock,
                }
                for item in return_items
            ],
        }

    def get_stock_updates(
        self,
        origin_id: str | None = None,
        *,
        until: datetime | None = None,
    ) -> list[dict[str, Any]]:
        """Return stock snapshots changed after the last fully ACKed stock batch."""
        origin = origin_id or self.get_origin_id()
        products = Product.objects.all().order_by('barcode')
        cursor = self._get_cursor('last_stock_push_at') or self._get_cursor('last_push_at')
        if cursor:
            products = products.filter(updated_at__gt=cursor)
        if until:
            products = products.filter(updated_at__lte=until)
        return [
            {
                'sync_id': make_stock_sync_id(origin, product.barcode),
                'barcode': product.barcode,
                'stock': product.stock,
                'updated_at': product.updated_at.isoformat(),
            }
            for product in products.only('barcode', 'stock', 'updated_at')
        ]

    def _headers(self) -> dict[str, str]:
        return {
            'Authorization': f'SyncToken {self.sync_token}',
            'Content-Type': 'application/json',
        }

    def _validate_response(
        self,
        result: Any,
        origin_id: str,
        *,
        require_acks: bool = True,
    ) -> dict[str, Any]:
        if not isinstance(result, dict):
            raise SyncProtocolError('Cloud response is not a JSON object.')
        if result.get('protocol') != SYNC_PROTOCOL:
            raise SyncProtocolError('Cloud returned an unexpected sync protocol.')
        if result.get('protocol_version') != SYNC_PROTOCOL_VERSION:
            raise SyncProtocolError('Cloud returned an unsupported sync protocol version.')
        try:
            response_origin = normalize_origin_id(result.get('origin_id'))
        except ValueError as exc:
            raise SyncProtocolError('Cloud response has an invalid origin_id.') from exc
        if response_origin != origin_id:
            raise SyncProtocolError('Cloud acknowledged a different sync origin.')
        if require_acks and not isinstance(result.get('acks'), dict):
            raise SyncProtocolError('Cloud response does not contain per-record acknowledgements.')
        return result

    @staticmethod
    def _accepted_ack_ids(
        acknowledgements: Any,
        sent_records: list[dict[str, Any]],
    ) -> tuple[set[str], list[dict[str, Any]], set[str]]:
        sent_ids = {record['sync_id'] for record in sent_records}
        accepted: set[str] = set()
        rejected: list[dict[str, Any]] = []
        seen: set[str] = set()
        if not isinstance(acknowledgements, list):
            return accepted, rejected, sent_ids

        for ack in acknowledgements:
            if not isinstance(ack, dict):
                continue
            sync_id = ack.get('sync_id')
            if sync_id not in sent_ids or sync_id in seen:
                continue
            seen.add(sync_id)
            if ack.get('status') in ACKNOWLEDGED_STATUSES:
                accepted.add(sync_id)
            else:
                rejected.append(ack)
        return accepted, rejected, sent_ids - seen

    def _record_sync_log(self, *, success: bool, count: int, details: dict, error: str = ''):
        try:
            SyncLog.objects.create(
                sync_type=SyncLog.SyncType.PUSH,
                records_synced=count,
                success=success,
                details=details,
                error_message=error,
            )
        except Exception:
            logger.exception('Could not persist synchronization log')

    @staticmethod
    def _record_batches(record_sets: dict[str, list[dict[str, Any]]]):
        """Yield fair protocol-sized batches without starving a record type."""
        positions = {name: 0 for name in record_sets}
        if not any(record_sets.values()):
            yield {name: [] for name in record_sets}
            return
        while any(positions[name] < len(records) for name, records in record_sets.items()):
            batch = {name: [] for name in record_sets}
            size = 0
            while size < MAX_RECORDS_PER_BATCH:
                progressed = False
                for name, records in record_sets.items():
                    position = positions[name]
                    if position >= len(records):
                        continue
                    batch[name].append(records[position])
                    positions[name] += 1
                    size += 1
                    progressed = True
                    if size >= MAX_RECORDS_PER_BATCH:
                        break
                if not progressed:
                    break
            yield batch

    def push_credits_snapshot(self, origin_id: str | None = None) -> dict[str, Any]:
        """Push the complete read-only credit ledger after sales are ACKed."""
        try:
            origin = origin_id or self._require_configuration()
            from credit.models import CreditPayment, CreditSale, Customer

            customers = [
                {
                    'local_id': str(customer.id),
                    'name': customer.name,
                    'phone': customer.phone or '',
                    'note': customer.note or '',
                    'created_at': customer.created_at.isoformat(),
                }
                for customer in Customer.objects.order_by('id')
            ]
            credit_sales = [
                {
                    'local_id': str(credit_sale.id),
                    'sale_sync_id': make_sync_id(
                        origin, 'sale', credit_sale.sale_id,
                    ),
                    'customer_local_id': str(credit_sale.customer_id),
                    'status': credit_sale.status,
                    'paid_amount': str(credit_sale.paid_amount),
                    'created_at': credit_sale.created_at.isoformat(),
                }
                for credit_sale in CreditSale.objects.order_by('id')
            ]
            credit_payments = [
                {
                    'local_id': str(payment.id),
                    'credit_sale_local_id': str(payment.credit_sale_id),
                    'amount': str(payment.amount),
                    'note': payment.note or '',
                    'operation_id': payment.operation_id,
                    'operation_payload_hash': payment.operation_payload_hash,
                    'status': payment.status,
                    'created_by_username': (
                        payment.created_by.username
                        if payment.created_by_id else None
                    ),
                    'reversed_by_username': (
                        payment.reversed_by.username
                        if payment.reversed_by_id else None
                    ),
                    'reversed_at': (
                        payment.reversed_at.isoformat()
                        if payment.reversed_at else None
                    ),
                    'reversal_reason': payment.reversal_reason,
                    'reversal_operation_id': payment.reversal_operation_id,
                    'reversal_payload_hash': payment.reversal_payload_hash,
                    'created_at': payment.created_at.isoformat(),
                }
                for payment in CreditPayment.objects.select_related(
                    'created_by', 'reversed_by',
                ).order_by('id')
            ]
            response = self.http_client.post(
                self._endpoint('credits'),
                json={
                    'protocol': SYNC_PROTOCOL,
                    'protocol_version': SYNC_PROTOCOL_VERSION,
                    'origin_id': origin,
                    'snapshot_at': timezone.now().isoformat(),
                    'customers': customers,
                    'credit_sales': credit_sales,
                    'credit_payments': credit_payments,
                },
                headers=self._headers(),
                timeout=60,
            )
            if response.status_code != 200:
                return {
                    'status': 'error',
                    'message': f'Cloud returned HTTP {response.status_code}',
                    'details': response.text[:500],
                }
            result = self._validate_response(
                response.json(), origin, require_acks=False,
            )
            return {
                'status': 'success',
                'customers': result.get('customers_imported', 0),
                'credit_sales': result.get('credit_sales_imported', 0),
                'credit_payments': result.get('credit_payments_imported', 0),
            }
        except (
            requests.exceptions.RequestException,
            ValueError,
            SyncConfigurationError,
            SyncProtocolError,
        ) as exc:
            logger.error('Credits snapshot push failed: %s', exc)
            return {'status': 'error', 'message': str(exc)}
        except Exception:
            logger.exception('Credits snapshot push failed')
            return {'status': 'error', 'message': 'Credits snapshot push failed.'}

    def push_to_cloud(self) -> dict[str, Any]:
        """Push bounded protocol-v1 batches and apply only exact ACKs."""
        try:
            origin_id = self._require_configuration()
        except SyncConfigurationError as exc:
            return {'status': 'error', 'code': 'not_configured', 'message': str(exc)}

        batch_cutoff = timezone.now()
        sales = self.get_pending_sales(origin_id)
        returns = self.get_pending_returns(origin_id, until=batch_cutoff)
        stock_updates = self.get_stock_updates(origin_id, until=batch_cutoff)
        sale_ids_by_sync = {record['sync_id']: record['local_id'] for record in sales}
        return_records_by_sync = {record['sync_id']: record for record in returns}
        accepted_sales = set()
        accepted_returns = set()
        accepted_stock = set()
        rejected_sales = []
        rejected_returns = []
        rejected_stock = []
        missing_sales = set()
        missing_returns = set()
        missing_stock = set()
        transport_error = ''
        submitted_count = 0
        batches = list(self._record_batches({
            'sales': sales,
            'returns': returns,
            'stock_updates': stock_updates,
        }))
        completed_batches = 0

        for batch in batches:
            payload = {
                'protocol': SYNC_PROTOCOL,
                'protocol_version': SYNC_PROTOCOL_VERSION,
                'origin_id': origin_id,
                'sent_at': batch_cutoff.isoformat(),
                **batch,
            }
            try:
                response = self.http_client.post(
                    self._endpoint('receive'),
                    json=payload,
                    headers=self._headers(),
                    timeout=60,
                )
                if response.status_code != 200:
                    transport_error = f'Cloud returned HTTP {response.status_code}'
                    break
                result = self._validate_response(response.json(), origin_id)
            except (
                requests.exceptions.RequestException,
                ValueError,
                SyncProtocolError,
            ) as exc:
                transport_error = str(exc)
                logger.error('Sync push batch failed: %s', exc)
                break

            acks = result['acks']
            batch_sales, batch_rejected_sales, batch_missing_sales = (
                self._accepted_ack_ids(acks.get('sales'), batch['sales'])
            )
            batch_returns, batch_rejected_returns, batch_missing_returns = (
                self._accepted_ack_ids(acks.get('returns'), batch['returns'])
            )
            batch_stock, batch_rejected_stock, batch_missing_stock = (
                self._accepted_ack_ids(
                    acks.get('stock_updates'),
                    batch['stock_updates'],
                )
            )
            accepted_sales.update(batch_sales)
            accepted_returns.update(batch_returns)
            accepted_stock.update(batch_stock)
            rejected_sales.extend(batch_rejected_sales)
            rejected_returns.extend(batch_rejected_returns)
            rejected_stock.extend(batch_rejected_stock)
            missing_sales.update(batch_missing_sales)
            missing_returns.update(batch_missing_returns)
            missing_stock.update(batch_missing_stock)
            submitted_count += sum(len(records) for records in batch.values())
            completed_batches += 1

            with transaction.atomic():
                if batch_sales:
                    Sale.objects.filter(
                        id__in=[
                            sale_ids_by_sync[sync_id]
                            for sync_id in batch_sales
                        ],
                        synced=False,
                    ).update(synced=True)
                for sync_id in batch_returns:
                    record = return_records_by_sync[sync_id]
                    Return.objects.filter(
                        id=record['local_id'],
                        status=record['status'],
                        updated_at=record['updated_at'],
                    ).update(synced=True)

        state_errors = []
        all_batches_completed = completed_batches == len(batches)
        if (
            all_batches_completed
            and not missing_stock
            and not rejected_stock
            and len(accepted_stock) == len(stock_updates)
        ):
            try:
                self._set_cursor('last_stock_push_at', batch_cutoff)
            except SyncConfigurationError as exc:
                state_errors.append(str(exc))
        if (
            all_batches_completed
            and not missing_returns
            and not rejected_returns
            and len(accepted_returns) == len(returns)
        ):
            try:
                self._set_cursor('last_return_push_at', batch_cutoff)
            except SyncConfigurationError as exc:
                state_errors.append(str(exc))
                # Without a durable return cursor, keep these rows pending so a
                # future status transition cannot disappear after a restart.
                Return.objects.filter(
                    id__in=[
                        return_records_by_sync[sync_id]['local_id']
                        for sync_id in accepted_returns
                    ]
                ).update(synced=False)

        rejected = rejected_sales + rejected_returns + rejected_stock
        missing = sorted(missing_sales | missing_returns | missing_stock)
        fully_acknowledged = (
            all_batches_completed
            and not rejected
            and not missing
            and not state_errors
            and not transport_error
        )
        if fully_acknowledged:
            try:
                self._set_cursor('last_push_at', batch_cutoff)
            except SyncConfigurationError as exc:
                state_errors.append(str(exc))
                fully_acknowledged = False
        credits_snapshot = (
            self.push_credits_snapshot(origin_id)
            if fully_acknowledged
            else {'status': 'skipped', 'message': 'primary sync incomplete'}
        )
        acknowledged_count = len(accepted_sales) + len(accepted_returns) + len(accepted_stock)
        details = {
            'sales_acked': len(accepted_sales),
            'returns_acked': len(accepted_returns),
            'stock_updates_acked': len(accepted_stock),
            'rejected': rejected,
            'missing_ack_ids': missing,
            'state_errors': state_errors,
            'transport_error': transport_error,
            'batches_completed': completed_batches,
            'batches_total': len(batches),
            'records_submitted': submitted_count,
            'credits_snapshot': credits_snapshot,
        }
        self._record_sync_log(
            success=fully_acknowledged,
            count=acknowledged_count,
            details=details,
            error=(
                ''
                if fully_acknowledged
                else transport_error
                or 'Some records were rejected or not acknowledged.'
            ),
        )
        return {
            'status': (
                'success'
                if fully_acknowledged
                else 'partial'
                if acknowledged_count
                else 'error'
            ),
            'synced_sales': len(accepted_sales),
            'acknowledged_returns': len(accepted_returns),
            'synced_terminal_returns': sum(
                1
                for sync_id in accepted_returns
                if return_records_by_sync[sync_id]['status'] in TERMINAL_RETURN_STATUSES
            ),
            'synced_stock_updates': len(accepted_stock),
            'rejected': rejected,
            'missing_ack_ids': missing,
            'state_errors': state_errors,
            'transport_error': transport_error,
            'batches_completed': completed_batches,
            'batches_total': len(batches),
            'records_submitted': submitted_count,
            'credits_snapshot': credits_snapshot,
        }

    def pull_from_cloud(self) -> dict[str, Any]:
        """Pull and atomically import protocol-v1 master data."""
        try:
            origin_id = self._require_configuration()
        except SyncConfigurationError as exc:
            return {'status': 'error', 'code': 'not_configured', 'message': str(exc)}

        params = {
            'protocol_version': SYNC_PROTOCOL_VERSION,
            'origin_id': origin_id,
        }
        cursor = self._get_cursor('last_pull_at')
        if cursor:
            params['since'] = cursor.isoformat()

        try:
            response = self.http_client.get(
                self._endpoint('master-data'),
                headers=self._headers(),
                params=params,
                timeout=60,
            )
            if response.status_code != 200:
                return {
                    'status': 'error',
                    'message': f'Cloud returned HTTP {response.status_code}',
                    'details': response.text[:500],
                }
            data = self._validate_response(response.json(), origin_id, require_acks=False)
            with transaction.atomic():
                categories_count = self._import_categories(data.get('categories', []))
                suppliers_count = self._import_suppliers(data.get('suppliers', []))
                products_count = self._import_products(data.get('products', []))
        except (requests.exceptions.RequestException, ValueError, KeyError, SyncProtocolError) as exc:
            logger.error('Sync pull failed: %s', exc)
            return {'status': 'error', 'message': str(exc)}
        except Exception:
            logger.exception('Master-data import failed')
            return {'status': 'error', 'message': 'Master-data import failed.'}

        response_timestamp = _parse_state_datetime(data.get('timestamp'))
        if response_timestamp is None:
            return {'status': 'error', 'message': 'Cloud response timestamp is invalid.'}
        try:
            self._set_cursor('last_pull_at', response_timestamp)
        except SyncConfigurationError as exc:
            return {'status': 'error', 'message': str(exc)}
        return {
            'status': 'success',
            'imported_categories': categories_count,
            'imported_suppliers': suppliers_count,
            'imported_products': products_count,
        }

    @staticmethod
    def _import_categories(categories: list[dict[str, Any]]) -> int:
        count = 0
        for data in categories:
            category = Category.objects.filter(name=data['name']).order_by('id').first()
            created = category is None
            if created:
                Category.objects.create(
                    name=data['name'],
                    description=data.get('description', ''),
                    icon=data.get('icon', ''),
                    color=data.get('color', ''),
                )
            else:
                category.description = data.get('description', '')
                category.icon = data.get('icon', '')
                category.color = data.get('color', '')
                category.save(update_fields=['description', 'icon', 'color'])
            count += int(created)
        return count

    @staticmethod
    def _import_suppliers(suppliers: list[dict[str, Any]]) -> int:
        count = 0
        for data in suppliers:
            supplier = Supplier.objects.filter(name=data['name']).order_by('id').first()
            created = supplier is None
            defaults = {
                'contact_name': data.get('contact_name', ''),
                'email': data.get('email', ''),
                'phone': data.get('phone', ''),
                'address': data.get('address', ''),
                'notes': data.get('notes', ''),
                'active': data.get('active', True),
            }
            if created:
                Supplier.objects.create(name=data['name'], **defaults)
            else:
                for field, value in defaults.items():
                    setattr(supplier, field, value)
                supplier.save(update_fields=[*defaults.keys(), 'updated_at'])
            count += int(created)
        return count

    @staticmethod
    def _import_products(products: list[dict[str, Any]]) -> int:
        count = 0
        for data in products:
            category = None
            if data.get('category_name'):
                category = Category.objects.filter(
                    name=data['category_name']
                ).order_by('id').first()
                if category is None:
                    category = Category.objects.create(name=data['category_name'])
            supplier = None
            if data.get('supplier_name'):
                supplier = Supplier.objects.filter(
                    name=data['supplier_name']
                ).order_by('id').first()
                if supplier is None:
                    supplier = Supplier.objects.create(name=data['supplier_name'])

            product = Product.objects.select_for_update().filter(
                barcode=data['barcode']
            ).first()
            defaults = {
                'name': data['name'],
                'description': data.get('description', ''),
                'category': category,
                'supplier': supplier,
                'purchase_price': Decimal(str(data.get('purchase_price', 0))),
                'sale_price_ht': Decimal(str(data.get('sale_price_ht', 0))),
                'tva': Decimal(str(data.get('tva', 20))),
                'min_stock': data.get('min_stock', 5),
                'active': data.get('active', True),
            }
            if product:
                ProductCostLayer.reconcile_to_stock(
                    product,
                    note='Réconciliation avant mise à jour maître',
                )
                old_purchase_price = product.purchase_price
                old_sale_price = product.sale_price_ht
                for field, value in defaults.items():
                    setattr(product, field, value)
                product.save(update_fields=[*defaults.keys(), 'updated_at'])
                if (
                    old_purchase_price != product.purchase_price
                    or old_sale_price != product.sale_price_ht
                ):
                    PriceHistory.objects.create(
                        product=product,
                        old_purchase_price=old_purchase_price,
                        new_purchase_price=product.purchase_price,
                        old_sale_price=old_sale_price,
                        new_sale_price=product.sale_price_ht,
                        changed_by=None,
                        reason='Mise à jour des données maîtres synchronisées',
                    )
            else:
                # Stock belongs to the local origin. New master products start at
                # zero rather than copying the cloud's reference stock.
                Product.objects.create(barcode=data['barcode'], stock=0, **defaults)
                count += 1
        return count

    def full_sync(self) -> dict[str, Any]:
        return {
            'push': self.push_to_cloud(),
            'pull': self.pull_from_cloud(),
            'timestamp': timezone.now().isoformat(),
        }


sync_service = SyncService()
