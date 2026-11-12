# Lists, counts, and questions

## Decide how to count

1. Open the most narrow view the app has: its search, filter, or sorted view for the question. A smaller list has fewer pages to read.
2. Observe. Find the list node and its rows.
3. Use this table. Stop at the first row that applies.

| The tree shows | Do |
| --- | --- |
| `[rows=N]` on the list | `N` is the total, offscreen rows included. Count from it |
| All relevant rows, and no row is `[offscreen]`, clipped at an edge, or followed by more content | Count the rows in this tree |
| Any other case | Collect (below) |

4. Count rows, not text. Attach each value to the row that contains it. Never count a child label across the whole tree: the same text can occur in a header, a filter chip, or two rows.

## Collect

```sh
agentsims scroll down --to-end --collect <selector> --in <list ref or label> -d <id>
```

- Always pass `--in` with the `[scrollable]` list node. Without it, `scroll` can move a different region. The first output line names the region it used. Check that it is your list.
- Pick the selector from the rows in the tree:
  - The rows have a test ID → use the test ID.
  - The rows print as `generic "<title>"` → use `generic`. A row takes the label of its first text, so `--collect text` returns only the other texts inside the rows.
  - The rows have a role such as `cell` → use that role.
- Read `collected  N items` and `endReached=`.
  - `endReached=yes` → `N` is complete. Collection keeps rows that are truly identical and removes only the overlap between two pages.
  - `endReached=no` → the list is longer than the page limit. Narrow the view with the app's search or filter and collect again. If you cannot narrow it, report the count as partial and say so.

## Answer a question

1. Get the complete relevant rows with the procedure above.
2. When the answer needs a field that the row does not show, open that item, read the field, and go back.
3. Answer in the exact format that the task asks for, with the exact text from the tree.
