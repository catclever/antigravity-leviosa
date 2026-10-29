#!/usr/bin/env python3
"""
Antigravity Subagent Cleanup Tool
Safely scans and removes orphaned subagent and summoned agent conversation directories from the brain storage.
"""

import os
import glob
import re
import json
import shutil
import stat
import argparse
import time

def get_brain_dir():
    return os.path.expanduser('~/.gemini/antigravity/brain')

def remove_readonly(func, path, excinfo):
    """Handles readonly files (like Go build caches or git packfiles)."""
    try:
        os.chmod(path, stat.S_IWRITE)
        func(path)
    except Exception:
        pass

def get_latest_mtime(path):
    """Returns the latest modification time of a directory or its files."""
    latest = os.path.getmtime(path)
    for root, dirs, files in os.walk(path):
        for f in files:
            fp = os.path.join(root, f)
            try:
                m = os.path.getmtime(fp)
                if m > latest:
                    latest = m
            except Exception:
                pass
    return latest

def collect_subagent_uuids(transcript_files, current_uuid=None):
    subagent_uuids = set()
    uuid_pattern = re.compile(r'(?:\\?"|")conversationId(?:\\?"|")\s*:\s*(?:\\?"|")([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?:\\?"|")')
    
    for filepath in transcript_files:
        if not os.path.exists(filepath):
            continue
        try:
            with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                for line in f:
                    if 'invoke_subagent' in line or 'conversationId' in line:
                        matches = uuid_pattern.findall(line)
                        for match in matches:
                            if current_uuid and match == current_uuid:
                                continue
                            subagent_uuids.add(match)
        except Exception:
            pass

    return subagent_uuids

def collect_summoned_uuids(transcript_files, current_uuid=None):
    summoned_uuids = set()
    for filepath in transcript_files:
        if not os.path.exists(filepath):
            continue
        try:
            with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                for line in f:
                    try:
                        step = json.loads(line)
                        if step.get('type') == 'USER_INPUT':
                            content = step.get('content', '')
                            if 'Execute Task ID:' in content:
                                uuid = os.path.basename(os.path.dirname(os.path.dirname(os.path.dirname(filepath))))
                                if current_uuid and uuid == current_uuid:
                                    pass
                                else:
                                    summoned_uuids.add(uuid)
                            break
                    except json.JSONDecodeError:
                        continue
        except Exception:
            pass

    return summoned_uuids

def get_directory_size(path):
    total = 0
    for root, dirs, files in os.walk(path):
        for f in files:
            fp = os.path.join(root, f)
            try:
                total += os.path.getsize(fp)
            except Exception:
                pass
    return total

def main():
    parser = argparse.ArgumentParser(description="Clean up orphaned subagents and summoned agents from ~/.gemini/antigravity/brain.")
    parser.add_argument("--session", "-s", help="Scope cleanup strictly to subagents spawned by the specified parent session UUID.")
    parser.add_argument("--all-sessions", action="store_true", help="Perform global scan across all conversation directories.")
    parser.add_argument("--exclude", help="UUID to exclude from deletion (e.g. current conversation ID).")
    parser.add_argument("--min-age-hours", type=float, default=1.0, help="Minimum age in hours for targets to be cleaned (default: 1.0h; pass 0 to disable).")
    parser.add_argument("--regular-only", action="store_true", help="Only clean standard invoke_subagent spawned subagents.")
    parser.add_argument("--summoned-only", action="store_true", help="Only clean PVE-summoned independent agents.")
    parser.add_argument("--quiet", "-q", action="store_true", help="Run silently without printing scan progress.")
    parser.add_argument("--dry-run", "-n", action="store_true", help="Scan and display target directories without deleting.")
    
    args = parser.parse_args()
    
    current_uuid = args.exclude or os.path.basename(os.getenv('GEMINI_AGENT_BRAIN_DIR', ''))
    brain_dir = get_brain_dir()
    
    def log(msg):
        if not args.quiet:
            print(msg)
            
    log("=== Antigravity Subagent Cleanup ===")
    log(f"Brain Storage : {brain_dir}")
    if args.session:
        log(f"Session Scope : {args.session} (Isolated Cleanup, Min Age: {args.min_age_hours}h)")
    else:
        log(f"Session Scope : All Sessions (Global, Min Age: {args.min_age_hours}h)")
    if current_uuid:
        log(f"Excluding Self: {current_uuid}")
    log("-" * 50)
    
    # Determine which transcript files to scan
    if args.session:
        session_transcript = os.path.join(brain_dir, args.session, '.system_generated', 'logs', 'transcript.jsonl')
        transcript_files = [session_transcript]
    else:
        transcript_files = glob.glob(os.path.join(brain_dir, '*', '.system_generated', 'logs', 'transcript.jsonl'))
    
    targets = set()
    
    if not args.summoned_only:
        log("Scanning for standard subagent signatures...")
        subagents = collect_subagent_uuids(transcript_files, current_uuid)
        log(f"  Found {len(subagents)} recorded standard subagent(s).")
        targets.update(subagents)
        
    if not args.regular_only and not args.session:
        # PVE-summoned independent agents are top-level conversations, only relevant in global mode
        log("Scanning for PVE-summoned agent signatures...")
        summoned = collect_summoned_uuids(transcript_files, current_uuid)
        log(f"  Found {len(summoned)} recorded summoned agent(s).")
        targets.update(summoned)

    # Filter to existing directories on disk and apply safety checks
    existing_dirs = []
    total_bytes = 0
    now = time.time()
    min_age_seconds = args.min_age_hours * 3600 if args.min_age_hours > 0 else 0

    for uuid in targets:
        target_path = os.path.join(brain_dir, uuid)
        if os.path.exists(target_path) and os.path.isdir(target_path):
            if min_age_seconds > 0:
                latest_mtime = get_latest_mtime(target_path)
                age_seconds = now - latest_mtime
                if age_seconds < min_age_seconds:
                    log(f"  [Protected] {uuid} was active recently ({(age_seconds/3600):.1f}h ago < {args.min_age_hours}h), skipping.")
                    continue

            sz = get_directory_size(target_path)
            total_bytes += sz
            existing_dirs.append((uuid, target_path, sz))
            
    log("-" * 50)
    log(f"Total target directories on disk: {len(existing_dirs)} ({total_bytes / (1024*1024):.2f} MB)")
    
    if not existing_dirs:
        log("No eligible orphaned subagent directories found on disk. Clean!")
        return
        
    if args.dry_run:
        print("[Dry Run] Directories that would be removed:")
        for uuid, path, sz in existing_dirs:
            print(f"  - {uuid} ({sz / (1024*1024):.2f} MB)")
        return

    deleted = 0
    freed_bytes = 0
    for uuid, path, sz in existing_dirs:
        try:
            shutil.rmtree(path, onerror=remove_readonly)
            deleted += 1
            freed_bytes += sz
            log(f"✓ Removed: {uuid} ({sz / (1024*1024):.2f} MB)")
        except Exception as e:
            print(f"[Error] Failed to remove {uuid}: {e}")
            
    log("-" * 50)
    log(f"Cleanup complete! Removed {deleted} directories, freed {freed_bytes / (1024*1024):.2f} MB.")

if __name__ == "__main__":
    main()
