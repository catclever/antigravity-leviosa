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

def get_brain_dir():
    return os.path.expanduser('~/.gemini/antigravity/brain')

def remove_readonly(func, path, excinfo):
    """Handles readonly files (like Go build caches or git packfiles)."""
    try:
        os.chmod(path, stat.S_IWRITE)
        func(path)
    except Exception:
        pass

def collect_subagent_uuids(current_uuid=None):
    brain_dir = get_brain_dir()
    subagent_uuids = set()
    uuid_pattern = re.compile(r'(?:\\?"|")conversationId(?:\\?"|")\s*:\s*(?:\\?"|")([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?:\\?"|")')
    transcript_files = glob.glob(os.path.join(brain_dir, '*', '.system_generated', 'logs', 'transcript.jsonl'))
    
    for filepath in transcript_files:
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

def collect_summoned_uuids(current_uuid=None):
    brain_dir = get_brain_dir()
    summoned_uuids = set()
    transcript_files = glob.glob(os.path.join(brain_dir, '*', '.system_generated', 'logs', 'transcript.jsonl'))
    
    for filepath in transcript_files:
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
    parser.add_argument("--dry-run", "-n", action="store_true", help="Scan and display target directories without deleting.")
    parser.add_argument("--exclude", help="UUID to exclude from deletion (e.g. current conversation ID).")
    parser.add_argument("--regular-only", action="store_true", help="Only clean standard invoke_subagent spawned subagents.")
    parser.add_argument("--summoned-only", action="store_true", help="Only clean PVE-summoned independent agents.")
    
    args = parser.parse_args()
    
    current_uuid = args.exclude or os.path.basename(os.getenv('GEMINI_AGENT_BRAIN_DIR', ''))
    brain_dir = get_brain_dir()
    
    print("=== Antigravity Subagent Cleanup ===")
    print(f"Brain Storage : {brain_dir}")
    if current_uuid:
        print(f"Excluding Self: {current_uuid}")
    print("-" * 50)
    
    targets = set()
    
    if not args.summoned_only:
        print("Scanning for standard subagent signatures...")
        subagents = collect_subagent_uuids(current_uuid)
        print(f"  Found {len(subagents)} recorded standard subagent(s).")
        targets.update(subagents)
        
    if not args.regular_only:
        print("Scanning for PVE-summoned agent signatures...")
        summoned = collect_summoned_uuids(current_uuid)
        print(f"  Found {len(summoned)} recorded summoned agent(s).")
        targets.update(summoned)

    # Filter to existing directories on disk
    existing_dirs = []
    total_bytes = 0
    for uuid in targets:
        target_path = os.path.join(brain_dir, uuid)
        if os.path.exists(target_path) and os.path.isdir(target_path):
            sz = get_directory_size(target_path)
            total_bytes += sz
            existing_dirs.append((uuid, target_path, sz))
            
    print("-" * 50)
    print(f"Total target directories on disk: {len(existing_dirs)} ({total_bytes / (1024*1024):.2f} MB)")
    
    if not existing_dirs:
        print("No orphaned subagent directories found on disk. Clean!")
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
            print(f"✓ Removed: {uuid} ({sz / (1024*1024):.2f} MB)")
        except Exception as e:
            print(f"[Error] Failed to remove {uuid}: {e}")
            
    print("-" * 50)
    print(f"Cleanup complete! Removed {deleted} directories, freed {freed_bytes / (1024*1024):.2f} MB.")

if __name__ == "__main__":
    main()
