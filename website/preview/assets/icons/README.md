# Interface icons

The dashboard, welcome page, chat widget, and website use upstream icon geometry. No runtime icon service or extra package is required.

- **Lucide**: revision `c29c276f16590cf017126671535ad8c792be64d8`. Source: https://github.com/lucide-icons/lucide/tree/c29c276f16590cf017126671535ad8c792be64d8/icons. See `LICENSE-Lucide.txt` (ISC and inherited Feather MIT).
- **GitHub**: Primer Octicons `mark-github-16.svg`, revision `6dbe38e4e9b4987b2c9332d719c57fbbdd083e2d`. Source: https://github.com/primer/octicons/blob/6dbe38e4e9b4987b2c9332d719c57fbbdd083e2d/icons/mark-github-16.svg. See `LICENSE-Octicons.txt` (MIT).
- **Roblox Studio**: Simple Icons `robloxstudio.svg`, revision `cfd64da491b75a5cfc48d4e477db8dbc55be41d6`. Source: https://github.com/simple-icons/simple-icons/blob/cfd64da491b75a5cfc48d4e477db8dbc55be41d6/icons/robloxstudio.svg. See `LICENSE-Simple-Icons.txt` (CC0). The mark identifies the connected Studio product.

`interface.svg` packages those icons as named SVG symbols; only the SVG container changes. Paths and shape coordinates remain unchanged. The isolated chat widget creates the same Lucide close/check/loading geometry through DOM APIs for compatibility with strict host CSPs.

The existing Helium H-with-star mark is the intentional custom brand exception and remains unchanged.
