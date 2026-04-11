"""
Shared file-upload validators used across serializers.
"""
from rest_framework import serializers

# Maximum image size: 5 MB
MAX_IMAGE_SIZE = 5 * 1024 * 1024
ALLOWED_IMAGE_EXTENSIONS = {'jpg', 'jpeg', 'png', 'webp', 'gif'}

# Maximum Excel/CSV import size: 10 MB
MAX_IMPORT_SIZE = 10 * 1024 * 1024
ALLOWED_IMPORT_EXTENSIONS = {'csv', 'xlsx', 'xls'}


def validate_image_upload(value):
    """
    Validate an uploaded image:
    - Extension must be in ALLOWED_IMAGE_EXTENSIONS
    - File size must be under MAX_IMAGE_SIZE
    - File must be readable as an image by Pillow

    Usage in a serializer:
        from core.validators import validate_image_upload

        class MySerializer(serializers.ModelSerializer):
            def validate_image(self, value):
                return validate_image_upload(value)
    """
    if value is None:
        return value

    # Check extension
    name = getattr(value, 'name', '') or ''
    ext = name.rsplit('.', 1)[-1].lower() if '.' in name else ''
    if ext not in ALLOWED_IMAGE_EXTENSIONS:
        raise serializers.ValidationError(
            f"Extension non autorisée '{ext}'. Formats acceptés : "
            f"{', '.join(sorted(ALLOWED_IMAGE_EXTENSIONS))}."
        )

    # Check size
    size = getattr(value, 'size', 0)
    if size > MAX_IMAGE_SIZE:
        mb = size / (1024 * 1024)
        raise serializers.ValidationError(
            f"Image trop volumineuse ({mb:.1f} Mo). Maximum : 5 Mo."
        )

    # Verify the file is actually a valid image using Pillow
    try:
        from PIL import Image
        # Seek to start in case the stream was already partially read
        if hasattr(value, 'seek'):
            value.seek(0)
        img = Image.open(value)
        img.verify()       # Raises if the image is corrupt or not an image
        if hasattr(value, 'seek'):
            value.seek(0)  # Reset so Django can save the file afterwards
    except Exception:
        raise serializers.ValidationError(
            "Le fichier n'est pas une image valide ou est corrompu."
        )

    return value


def validate_import_file(file):
    """
    Validate an uploaded Excel/CSV import file:
    - Extension must be in ALLOWED_IMPORT_EXTENSIONS
    - File size must be under MAX_IMPORT_SIZE

    Returns the file unchanged, or raises ValidationError / Response-ready dict.
    Intended to be called directly in a view before passing to pandas.
    """
    name = getattr(file, 'name', '') or ''
    ext = name.rsplit('.', 1)[-1].lower() if '.' in name else ''

    if ext not in ALLOWED_IMPORT_EXTENSIONS:
        raise ValueError(
            f"Extension non autorisée '{ext}'. "
            f"Formats acceptés : {', '.join(sorted(ALLOWED_IMPORT_EXTENSIONS))}."
        )

    size = getattr(file, 'size', 0)
    if size > MAX_IMPORT_SIZE:
        mb = size / (1024 * 1024)
        raise ValueError(
            f"Fichier trop volumineux ({mb:.1f} Mo). Maximum : 10 Mo."
        )

    return file
