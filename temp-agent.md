# AGENTS.md - Your Workspace

This folder is home. Treat it that way.

## Session Startup

Don't ask permission. Just do it.

## Memory

You wake up fresh each session. These files are your continuity:

- **Daily notes:** `memory/YYYY-MM-DD.md` (create `memory/` if needed) — raw logs of what happened
- **Long-term:** `MEMORY.md` — your curated memories, like a human's long-term memory

**The human rule:** Humans in group chats don't respond to every single message. Neither should you. Quality > quantity. If you wouldn't send it in a real group chat with friends, don't send it.

## Desktop file path

If the user mentions Desktop, the path is /Users/aidankim/Desktop.

## Creating files

When creating files, default to /Users/aidankim/Desktop unless I specify another path.

## Exec Policy

Approved exec binaries only:
python3, ls, pwd, curl, jq, mkdir, cp, mv, find, grep, cat, head, tail, touch, chmod, chown, sed

Strict rules:
1. Use `read` / `write` / `edit` before `exec` whenever possible.
2. Never use unapproved binaries.
3. Use absolute paths. 

## Web Search

For any request involving current events, news, recent developments, prices, scores, or anything that could have changed after your training cutoff — do not answer from memory. Always use web search to retrieve up-to-date information before responding.

### Workflow:

1. Convert the request into a short search query.
2. Use exec to run the local SearXNG helper script:
   python3 /Users/aidankim/.openclaw/workspace/scripts/searx_query.py "<query>"
3. Parse the returned JSON and inspect the results array.
4. Select the best result URLs, preferring official, direct, and reputable sources.
5. Use web_fetch on those URLs.
6. Answer using the fetched page content.
7. Cross-check with another source if the info is time-sensitive, high-stakes, unclear, or disputed.
8. Cite the URLs used.

### Reference command:

- Never claim verification unless you fetched supporting pages.
  python3 /Users/aidankim/.openclaw/workspace/scripts/searx_query.py "<query>"

### Rules:

- Start with the local SearXNG script unless the user explicitly provides a URL and only wants that page checked.
- Do not rely only on search snippets when the answer needs verification; fetch the actual pages.
- Prefer pages that directly answer the question over generic homepages.
- If a page is hard to read, try another result.
- If some search engines fail, continue with the available results.
- If sources disagree, say so clearly instead of guessing.
- Never claim verification unless you fetched supporting pages.




## begin_task workflow (single agent, exact order)

Trigger:
- Run this workflow only when the user message is exactly:
  begin_task

If the user message is anything else:
- Do not run this workflow.

Goal:
- Fetch 3 feeds one by one.
- After each fetch, immediately write the exact fetched output into its matching file.
- After all 3 fetch+write steps succeed, read all 3 files.
- After all 3 reads succeed, select exactly 9 news items total:
  - exactly 3 items from Simon Willison
  - exactly 3 items from The Decoder
  - exactly 3 items from Hugging Face
- Then produce one combined summary using those 9 selected items.

Hard rules:
- No parallel execution.
- No skipped steps.
- No reordered steps.
- Stop on first failure.
- Do not retry automatically.
- Do not summarize before all 3 reads succeed.
- All write calls must overwrite existing file contents.
- Never append.
- Assume the files already exist, and replace their contents.
- The content passed to each write call must be the exact output of the immediately preceding web_fetch call.
- Do not trim, clean, transform, paraphrase, summarize, reformat, or filter before writing.
- Write the fetched output verbatim.

Output directory:
- /Users/aidankim/.openclaw/workspace/news

Execution contract:
1) Fetch Simon Willison feed.
2) Immediately write the exact fetched output into simonwillison.txt, overwriting the full file.
3) Fetch The Decoder feed.
4) Immediately write the exact fetched output into the-decoder.txt, overwriting the full file.
5) Fetch Hugging Face blog feed.
6) Immediately write the exact fetched output into huggingface.txt, overwriting the full file.
7) Only after steps 1 through 6 all succeed, read simonwillison.txt.
8) Read the-decoder.txt.
9) Read huggingface.txt.
10) Only after steps 7 through 9 all succeed, select the best 3 relevant news items from each source.
11) Produce one combined summary across the 9 selected items.

Required exact tool-call sequence:
1. web_fetch(url="https://simonwillison.net/atom/everything/", extractMode="text")
2. write(path="/Users/aidankim/.openclaw/workspace/news/simonwillison.txt", content=<exact output of step 1 verbatim>)

3. web_fetch(url="https://the-decoder.com/feed/", extractMode="text")
4. write(path="/Users/aidankim/.openclaw/workspace/news/the-decoder.txt", content=<exact output of step 3 verbatim>)

5. web_fetch(url="https://huggingface.co/blog", extractMode="text")
6. write(path="/Users/aidankim/.openclaw/workspace/news/huggingface.txt", content=<exact output of step 5 verbatim>)

7. read(path="/Users/aidankim/.openclaw/workspace/news/simonwillison.txt")
8. read(path="/Users/aidankim/.openclaw/workspace/news/the-decoder.txt")
9. read(path="/Users/aidankim/.openclaw/workspace/news/huggingface.txt")

10. From the contents returned by steps 7 through 9, select exactly 3 relevant news items from each source.
11. Summarize all 9 selected items together.

Selection rules:
- Final output must contain exactly 9 items total.
- Final output must contain exactly 3 items per source.
- Choose the most relevant items for:
  - AI/ML
  - model releases
  - major updates
  - developer tools
  - open-source
  - local models
  - agents
  - coding tools
  - important industry changes
- Prefer concrete news over vague commentary.
- Prefer items with clear user/developer relevance.
- Ignore obvious low-signal filler if stronger items exist.

No-overlap rules:
- Do not include duplicate or duplicate stories in the final 9.

Hugging Face special rule:
- For Hugging Face, select the 3 most recent relevant items from the Hugging Face file.

Summary rules:
- Use only the contents returned by the 3 read calls.
- Do not use outside knowledge.
- Do not invent missing facts.
- Produce one combined summary, not 3 separate summaries.
- Base the summary only on the 9 selected items.
- Make clear which source each selected item came from.
- Keep the summary grounded in the read file contents.
