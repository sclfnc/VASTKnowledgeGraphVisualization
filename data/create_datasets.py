import argparse
import csv
import json
import re
import shutil
import sys
from pathlib import Path

import networkx as nx
from download_github_zip import process_url


def create_influence_graph(destination_dir):
    data_dir = Path('data')

    try:
        process_url(
            'https://github.com/vast-challenge/2025-data/blob/main/MC1_release.zip',
            destination_dir=data_dir,
        )
    except Exception as e:  # noqa: BLE001
        print('Error:', e, file=sys.stderr)
        return 1

    data_path = data_dir / 'MC1_release/MC1_graph.json'

    try:
        with open(data_path) as file:
            data = json.load(file)
    except OSError as e:
        print('Error', e, file=sys.stderr)
        return 1

    graph = nx.node_link_graph(data, edges='links')

    nodes = filter(
        lambda node: node[1].get('Node Type') in ('Song', 'Album'),
        graph.nodes(data=True),
    )
    infl_graph = graph.subgraph([node for node, _ in nodes]).copy()
    for node in infl_graph.nodes:
        infl_graph.nodes[node]['Node Type'] = infl_graph.nodes[node].get('genre', 'Unknown')

    output_path = destination_dir / 'genre_influence.json'
    try:
        with open( output_path, 'w') as file:
            json.dump(nx.node_link_data(infl_graph), file)
    except OSError as e:
        print('Error', e, file=sys.stderr)
        return 1
    print(f'Created {output_path}:', graph)
    return 0

def download_asoiaf_data(data_dir):
    names = ['all-nodes'] + [f'book{i}-edges' for i in range(1, 6)]
    urls = [
        f'https://github.com/mathbeveridge/asoiaf/blob/master/data/asoiaf-{name}.csv'
        for name in names
    ]

    try:
        data_dir.mkdir(parents=True, exist_ok=False)
    except Exception as e:  # noqa: BLE001
        print(f'Error {e}. Using existing files.', file=sys.stderr)
    else:
        try:
            for url in urls:
                process_url(url, destination_dir=data_dir)
        except Exception as e:  # noqa: BLE001
            print('Error', e, file=sys.stderr)
            return 1
    return 0

def create_asoiaf_graph(destination_dir):
    data_dir = Path('data')
    asoiaf_dir = data_dir / 'asoiaf'
    if download_asoiaf_data(asoiaf_dir):
        return 1

    graph = nx.MultiGraph()
    # Add nodes
    node_file = next(iter(asoiaf_dir.glob('*nodes*')))
    nodes = []
    families_re = re.compile('(Targaryen|Greyjoy|Snow|Baratheon|Lannister|Stark|Frey)')
    try:
        with open(node_file) as file:
            reader = csv.DictReader(file)
            for row in reader:
                nodes.append((row['Id'],
                {
                    'name': row['Label'],
                    'Node Type':  families_re.search(row['Label']).group()
                    if families_re.search(row['Label']) else 'Other',
                }))
    except Exception as e:  # noqa: BLE001
        print('Error', e, file=sys.stderr)
        return 1
    graph.add_nodes_from(nodes)

    # Add edges
    edge_files = asoiaf_dir.glob('*edges*')
    try:
        for path in edge_files:
            with open(path) as file:
                reader = csv.DictReader(file)
                graph.add_edges_from([
                    (row['Source'], row['Target'], {
                        'Edge Type': f'Book {row['book'] or 'Unknown'}',
                        })
                        for row in reader
                ])
    except Exception as e:  # noqa: BLE001
        print('Error', e, file=sys.stderr)
        return 1

    output_path = destination_dir / 'asoiaf_interaction.json'
    try:
        with open(output_path, 'w') as file:
            json.dump(nx.node_link_data(graph, edges='links'), file)
    except Exception as e:  # noqa: BLE001
        print('Error', e, file=sys.stderr)
        return 1
    print(f'Created {output_path}', graph)
    return 0

def cleanup():
    data_dir = Path('data')
    dirs = ['MC1_release', 'asoiaf']
    try:
        for d in dirs:
            shutil.rmtree(data_dir / d)
    except Exception as e:  # noqa: BLE001
        print('Error', e, file=sys.stderr)

def parse_args():
    parser = argparse.ArgumentParser(
        description=("Create two Knowledge Graphs for testing the application."),
    )
    parser.add_argument(
        "--output-dir",
        default=Path(__file__).resolve().parent,
        type=Path,
        help='Directory where knowledge graph files are saved (default ./data)'
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    destination_dir = args.output_dir.resolve()
    destination_dir.mkdir(parents=True, exist_ok=True)
    create_influence_graph(destination_dir)
    create_asoiaf_graph(destination_dir)
    cleanup()


if __name__ == '__main__':
    raise SystemExit(main())
