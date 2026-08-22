"""Streaming guards applied before Django stores uploaded files."""

from django.conf import settings
from django.core.exceptions import RequestDataTooBig
from django.core.files.uploadhandler import FileUploadHandler


class UploadSizeGuard(FileUploadHandler):
    """Pass chunks through while enforcing a per-file streaming limit."""

    def handle_raw_input(
        self,
        input_data,
        META,
        content_length,
        boundary,
        encoding=None,
    ):
        self._total_received_bytes = 0
        if (
            content_length is not None
            and content_length > settings.MAX_REQUEST_BODY_SIZE
        ):
            raise RequestDataTooBig(
                'Request body exceeds MAX_REQUEST_BODY_SIZE.'
            )

    def new_file(self, *args, **kwargs):
        super().new_file(*args, **kwargs)
        self._received_bytes = 0
        if not hasattr(self, '_total_received_bytes'):
            self._total_received_bytes = 0

    def receive_data_chunk(self, raw_data, start):
        self._received_bytes += len(raw_data)
        self._total_received_bytes += len(raw_data)
        if self._received_bytes > settings.MAX_SINGLE_FILE_UPLOAD_SIZE:
            raise RequestDataTooBig(
                'Uploaded file exceeds MAX_SINGLE_FILE_UPLOAD_SIZE.'
            )
        if self._total_received_bytes > settings.MAX_REQUEST_BODY_SIZE:
            raise RequestDataTooBig(
                'Uploaded files exceed MAX_REQUEST_BODY_SIZE.'
            )
        return raw_data

    def file_complete(self, file_size):
        return None
