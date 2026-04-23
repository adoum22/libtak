import django.core.validators
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name='ExpenseCategory',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=100, unique=True, verbose_name='Name')),
                ('is_default', models.BooleanField(default=False, help_text='Catégorie par défaut, non supprimable', verbose_name='Default Category')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
            ],
            options={
                'verbose_name': 'Expense Category',
                'verbose_name_plural': 'Expense Categories',
                'ordering': ['name'],
            },
        ),
        migrations.CreateModel(
            name='MonthlyAccounting',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('year', models.IntegerField(validators=[django.core.validators.MinValueValidator(2000), django.core.validators.MaxValueValidator(2100)], verbose_name='Year')),
                ('month', models.IntegerField(validators=[django.core.validators.MinValueValidator(1), django.core.validators.MaxValueValidator(12)], verbose_name='Month')),
                ('manager_withdrawal', models.DecimalField(decimal_places=2, default=0, help_text='Montant prélevé par le gérant (salaire/retrait)', max_digits=12, verbose_name='Manager Withdrawal')),
                ('notes', models.TextField(blank=True, verbose_name='Notes')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'verbose_name': 'Monthly Accounting',
                'verbose_name_plural': 'Monthly Accounting',
                'ordering': ['-year', '-month'],
                'unique_together': {('year', 'month')},
                'indexes': [models.Index(fields=['year', 'month'], name='accounting__year_month_idx')],
            },
        ),
        migrations.CreateModel(
            name='Expense',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('amount', models.DecimalField(decimal_places=2, max_digits=12, validators=[django.core.validators.MinValueValidator(0)], verbose_name='Amount')),
                ('description', models.CharField(blank=True, max_length=255, verbose_name='Description')),
                ('incurred_on', models.DateField(blank=True, null=True, verbose_name='Incurred On')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('category', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='expenses', to='accounting.expensecategory', verbose_name='Category')),
                ('monthly', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='expenses', to='accounting.monthlyaccounting', verbose_name='Monthly Accounting')),
            ],
            options={
                'verbose_name': 'Expense',
                'verbose_name_plural': 'Expenses',
                'ordering': ['-incurred_on', '-created_at'],
                'indexes': [models.Index(fields=['monthly', 'category'], name='accounting__monthly_cat_idx')],
            },
        ),
    ]
