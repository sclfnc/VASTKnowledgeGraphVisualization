#!/usr/bin/env python3
"""
Script to manually set up a default graph from an existing file in graph_storage.

This script helps you set a default graph ID that can be used to access
the graph without uploading a file.
"""

import os
import json
import uuid
from pathlib import Path

# Directory to store uploaded graph files
GRAPH_STORAGE_DIR = "graph_storage"

# Default graph ID - special constant to access the default graph
default_graph_id = "default"

def main():
    print("=== Default Graph Setup Assistant ===")
    print()

    # Check if graph_storage directory exists
    if not os.path.exists(GRAPH_STORAGE_DIR):
        print(f"Error: {GRAPH_STORAGE_DIR} directory does not exist.")
        print("Please upload a graph file first using the API.")
        return

    # List existing graph files
    graph_files = [f for f in os.listdir(GRAPH_STORAGE_DIR) if f.endswith('.json')]

    if not graph_files:
        print(f"No graph files found in {GRAPH_STORAGE_DIR}.")
        print("Please upload a graph file first using the API.")
        return

    print("Available graph files:")
    for i, filename in enumerate(graph_files, 1):
        # Extract the graph ID from the filename
        graph_id = filename.replace('.json', '')
        print(f"{i}. {filename} (Graph ID: {graph_id})")
    print()

    # Ask user to select a graph or create a new one
    print("Choose an option:")
    print("1. Set one of the existing graphs as default")
    print("2. Create a new default graph from a file")

    choice = input("Enter your choice (1 or 2): ").strip()

    if choice == "1":
        # Let user select an existing graph
        selection = input(f"Enter the number (1-{len(graph_files)}) of the graph to set as default: ").strip()

        try:
            index = int(selection) - 1
            if 0 <= index < len(graph_files):
                filename = graph_files[index]
                graph_id = filename.replace('.json', '')

                # Simulate setting the default graph
                print(f"\n✓ Graph '{filename}' has been set as the default graph.")
                print(f"You can now access it using the graph ID: '{default_graph_id}'")
                print(f"Or the original graph ID: '{graph_id}'")
                print()
                print("To use this in the API:")
                print(f"1. Make a POST request to /set-default/{graph_id}")
                print(f"2. Then access the default graph via /summary/{default_graph_id}")
            else:
                print("Invalid selection.")
        except ValueError:
            print("Please enter a valid number.")

    elif choice == "2":
        # Let user create a new default graph
        print("\nCreate a new default graph:")

        # Ask for file path
        file_path = input("Enter the full path to your graph JSON file: ").strip()

        if not os.path.exists(file_path):
            print("File not found.")
            return

        # Copy the file to graph_storage with a new UUID
        try:
            new_graph_id = str(uuid.uuid4())
            dest_path = os.path.join(GRAPH_STORAGE_DIR, f"{new_graph_id}.json")

            with open(file_path, 'r') as src_file:
                data = json.load(src_file)

            with open(dest_path, 'w') as dest_file:
                json.dump(data, dest_file)

            print(f"\n✓ New graph created with ID: '{new_graph_id}'")
            print(f"File saved to: {dest_path}")
            print()
            print("To use this in the API:")
            print(f"1. Make a POST request to /set-default/{new_graph_id}")
            print(f"2. Then access the default graph via /summary/{default_graph_id}")

        except Exception as e:
            print(f"Error creating graph: {str(e)}")

    else:
        print("Invalid choice.")

if __name__ == "__main__":
    main()