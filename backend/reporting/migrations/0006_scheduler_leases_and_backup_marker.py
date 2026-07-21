from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('reporting', '0005_reportsettings_schedule_markers'),
    ]

    operations = [
        migrations.AddField(
            model_name='reportsettings',
            name='backup_last_sent_on',
            field=models.DateField(blank=True, editable=False, null=True),
        ),
        migrations.CreateModel(
            name='ScheduledJobClaim',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('job_name', models.CharField(max_length=40)),
                ('run_date', models.DateField()),
                ('status', models.CharField(choices=[('RUNNING', 'Running'), ('SUCCESS', 'Success'), ('FAILED', 'Failed')], default='RUNNING', max_length=10)),
                ('claim_token', models.UUIDField()),
                ('claimed_at', models.DateTimeField()),
                ('lease_expires_at', models.DateTimeField()),
                ('completed_at', models.DateTimeField(blank=True, null=True)),
                ('result_message', models.TextField(blank=True)),
            ],
            options={
                'ordering': ['-run_date', 'job_name'],
                'indexes': [models.Index(fields=['status', 'lease_expires_at'], name='reporting_s_status_851330_idx')],
                'constraints': [models.UniqueConstraint(fields=('job_name', 'run_date'), name='reporting_unique_scheduled_job_day')],
            },
        ),
    ]
