from django.core.management.base import BaseCommand, CommandError

from reporting.tasks import daily_database_backup


class Command(BaseCommand):
    help = 'Create an encrypted database and media backup.'

    def handle(self, *args, **options):
        result = str(daily_database_backup())
        if result.startswith('Backup failed:'):
            raise CommandError(result)
        self.stdout.write(self.style.SUCCESS(result))
