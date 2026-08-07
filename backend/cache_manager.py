"""
cache_manager.py - High-Performance Caching & Memory Management Module for Cadanest
Provides SHA-256 hashing for 3D STEP models, persistent disk caching,
and explicit Open CASCADE C++ handle dereferencing & garbage collection.
"""

import os
import sys
import hashlib
import json
import gc
import shutil

CACHE_DIR = os.path.join(os.path.expanduser("~"), ".cadanest_cache")

def ensure_cache_dir():
    if not os.path.exists(CACHE_DIR):
        os.makedirs(CACHE_DIR, exist_ok=True)

def compute_file_hash(file_path: str, extra_params: dict = None) -> str:
    """
    Computes a SHA-256 hash of the target file content combined with processing parameters.
    """
    hasher = hashlib.sha256()
    if os.path.exists(file_path):
        with open(file_path, "rb") as f:
            while chunk := f.read(65536):
                hasher.update(chunk)
    else:
        hasher.update(file_path.encode("utf-8"))

    if extra_params:
        param_str = json.dumps(extra_params, sort_keys=True)
        hasher.update(param_str.encode("utf-8"))

    return hasher.hexdigest()

def get_cached_json(cache_key: str):
    ensure_cache_dir()
    cache_path = os.path.join(CACHE_DIR, f"{cache_key}.json")
    if os.path.exists(cache_path):
        try:
            with open(cache_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return None
    return None

def set_cached_json(cache_key: str, data: dict):
    ensure_cache_dir()
    cache_path = os.path.join(CACHE_DIR, f"{cache_key}.json")
    try:
        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        sys.stderr.write(f"Cache write error: {str(e)}\n")

def get_cached_file_path(cache_key: str, extension: str) -> str:
    ensure_cache_dir()
    cached_file = os.path.join(CACHE_DIR, f"{cache_key}.{extension.lstrip('.')}")
    if os.path.exists(cached_file):
        return cached_file
    return None

def store_cached_file(cache_key: str, source_path: str, extension: str) -> str:
    ensure_cache_dir()
    dest_path = os.path.join(CACHE_DIR, f"{cache_key}.{extension.lstrip('.')}")
    try:
        shutil.copyfile(source_path, dest_path)
        return dest_path
    except Exception as e:
        sys.stderr.write(f"Cache file store error: {str(e)}\n")
        return source_path

def cleanup_memory(*objects):
    """
    Triggers Python GC to free local Open CASCADE shape references
    (flat_shape, bend_lines) after each unfold.
    IMPORTANT: Does NOT clear _STEP_SHAPE_CACHE — the in-memory STEP
    shape cache must survive across batch calls so that IsSame/IsPartner
    face pointer matching works on the same TopoDS_Shape object.
    """
    for obj in objects:
        if obj is not None:
            del obj

    gc.collect()

def clear_cache_folder():
    """
    Completely and properly deletes all cached session files in the .cadanest_cache directory.
    Enforces strict zero-persistence between sessions.
    """
    ensure_cache_dir()
    try:
        for filename in os.listdir(CACHE_DIR):
            file_path = os.path.join(CACHE_DIR, filename)
            try:
                if os.path.isfile(file_path) or os.path.islink(file_path):
                    os.unlink(file_path)
                elif os.path.isdir(file_path):
                    shutil.rmtree(file_path)
            except Exception as e:
                sys.stderr.write(f"Failed to delete {file_path}. Reason: {e}\n")
    except Exception as ex:
        sys.stderr.write(f"Cache folder wipe error: {ex}\n")
