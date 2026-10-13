"""
Shared core library for all project-management backend services.

This package lives in ``backend/_shared`` (ignored by Terraform because of the
underscore prefix) and is copied into every service folder by
``bin/sync-shared.sh`` so that each Lambda package is self-contained.
"""
