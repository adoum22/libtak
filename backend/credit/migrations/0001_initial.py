from decimal import Decimal

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ('sales', '0007_alter_sale_payment_method'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='Customer',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=200, verbose_name='Nom')),
                ('phone', models.CharField(blank=True, max_length=30, verbose_name='Téléphone')),
                ('note', models.CharField(blank=True, max_length=200, verbose_name='Note')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'ordering': ['name'],
            },
        ),
        migrations.AddIndex(
            model_name='customer',
            index=models.Index(fields=['name'], name='credit_cust_name_idx'),
        ),
        migrations.CreateModel(
            name='CreditSale',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('status', models.CharField(
                    choices=[
                        ('UNPAID', 'Non réglé'),
                        ('PARTIAL', 'Partiellement réglé'),
                        ('PAID', 'Réglé'),
                    ],
                    default='UNPAID',
                    max_length=10,
                )),
                ('paid_amount', models.DecimalField(decimal_places=2, default=Decimal('0'), max_digits=10)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('customer', models.ForeignKey(
                    on_delete=django.db.models.deletion.PROTECT,
                    related_name='credit_sales',
                    to='credit.customer',
                )),
                ('sale', models.OneToOneField(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='credit',
                    to='sales.sale',
                )),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),
        migrations.AddIndex(
            model_name='creditsale',
            index=models.Index(fields=['status', '-created_at'], name='credit_cs_status_idx'),
        ),
        migrations.CreateModel(
            name='CreditPayment',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('amount', models.DecimalField(decimal_places=2, max_digits=10)),
                ('note', models.CharField(blank=True, max_length=200)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('created_by', models.ForeignKey(
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    to=settings.AUTH_USER_MODEL,
                )),
                ('credit_sale', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='payments',
                    to='credit.creditsale',
                )),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),
        migrations.AddIndex(
            model_name='creditpayment',
            index=models.Index(fields=['-created_at'], name='credit_pay_created_idx'),
        ),
    ]
