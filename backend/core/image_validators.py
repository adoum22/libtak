import warnings

from PIL import Image, UnidentifiedImageError
from rest_framework import serializers

MAX_IMAGE_SIZE = 2 * 1024 * 1024  # 2 MB
MAX_IMAGE_PIXELS = 25_000_000
MAX_IMAGE_DIMENSION = 10_000
MAX_IMAGE_FRAMES = 100
IMAGE_FORMAT_MIME_TYPES = {
    'JPEG': 'image/jpeg',
    'PNG': 'image/png',
    'WEBP': 'image/webp',
    'GIF': 'image/gif',
}
ALLOWED_IMAGE_TYPES = set(IMAGE_FORMAT_MIME_TYPES.values())


def validate_image_upload(value):
    """Validate encoded size, claimed MIME and the decoded image structure."""
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
    position = value.tell() if hasattr(value, 'tell') else 0
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(value) as image:
                actual_type = IMAGE_FORMAT_MIME_TYPES.get(image.format)
                if not actual_type:
                    raise serializers.ValidationError(
                        'Format image non supporté (JPEG/PNG/WebP/GIF uniquement).'
                    )
                if content_type and content_type != actual_type:
                    raise serializers.ValidationError(
                        "Le type MIME déclaré ne correspond pas à l'image."
                    )
                width, height = image.size
                if (
                    width <= 0
                    or height <= 0
                    or width > MAX_IMAGE_DIMENSION
                    or height > MAX_IMAGE_DIMENSION
                    or width * height > MAX_IMAGE_PIXELS
                ):
                    raise serializers.ValidationError(
                        'Dimensions image trop importantes.'
                    )
                if getattr(image, 'n_frames', 1) > MAX_IMAGE_FRAMES:
                    raise serializers.ValidationError(
                        "L'image contient trop de frames."
                    )
                image.verify()
    except serializers.ValidationError:
        raise
    except (
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
        UnidentifiedImageError,
        OSError,
        SyntaxError,
        ValueError,
    ) as exc:
        raise serializers.ValidationError(
            'Fichier image invalide ou corrompu.'
        ) from exc
    finally:
        if hasattr(value, 'seek'):
            value.seek(position)
    return value
