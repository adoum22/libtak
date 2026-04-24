from rest_framework import serializers

MAX_IMAGE_SIZE = 2 * 1024 * 1024  # 2 MB
ALLOWED_IMAGE_TYPES = {'image/jpeg', 'image/png', 'image/webp', 'image/gif'}


def validate_image_upload(value):
    """Reusable size + MIME validator for ImageField uploads."""
    if not value:
        return value
    if value.size > MAX_IMAGE_SIZE:
        raise serializers.ValidationError(
            'Image trop volumineuse (max 2 Mo).'
        )
    content_type = getattr(value, 'content_type', '') or ''
    if content_type and content_type not in ALLOWED_IMAGE_TYPES:
        raise serializers.ValidationError(
            'Format image non supporté (JPEG/PNG/WebP/GIF uniquement).'
        )
    return value
