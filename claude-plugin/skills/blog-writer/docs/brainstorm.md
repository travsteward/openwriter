# Mode: Brainstorm

User wants topic ideas. Open an OpenWriter doc and propose angles.

## When to use

- User says "brainstorm blog topics" / "what should I write about" / "blog ideas"
- Strategist hands off without an `angle` field — writer must ideate
- User has a vague sense ("something about pricing") but no specific topic

## Workflow

1. Read project `## Blog` config (see [project-config.md](project-config.md))
2. Read recent ship-events, PRs, or features the project has shipped lately
3. `create_document({ title: "Blog Ideas — [Project]", workspace: "[Project] Blog" })`
4. `populate_document({ content: "<topic list with angles>" })`
5. Discuss with user, refine, pick a topic
6. When a topic is locked, switch to `beats` mode — create the per-post container and start the beat extraction in a NEW `Beats — <Post Title>` doc

## What to propose

When ideating, consider these axes:

- **What's been shipping recently?** New features, fixes, breakthroughs — these are the easiest wins because the work is fresh and there's something concrete to show.
- **What questions do users ask?** Support tickets, Discord/Slack threads, Reddit/HN comments — recurring questions are blog gold.
- **What content gaps exist on the blog?** Read the existing blog index. What's missing? What's stale?
- **What's trending in the space?** Tie a project event to a broader industry moment.
- **What does the project's audience care about that the project hasn't said yet?** The unstated opinion, the contrarian take, the thing the founder believes but never wrote down.

## Format the brainstorm doc

```markdown
# Blog Topic Ideas — [Project]

## 1. [Topic title]
**Angle:** [the take, the hook, why this matters now]
**Tone:** [conversational / technical / contrarian / announcement]
**Length:** [short / long / tutorial]
**Why it works:** [1-2 sentences on what makes this post worth writing]

## 2. [Topic title]
...
```

Three to five options is the sweet spot. More than five becomes a menu the user has to wade through.

## Output

When the user picks a topic, return:

```json
{
  "status": "draft-ready",
  "artifact": { "doc_id": "<brainstorm doc>", "workspace_id": "..." },
  "next_steps": ["/blog-writer beats"],
  "notes": "User picked topic #N: '<title>'. Hand off to beats mode — extract beat structure + lock title/preview/slug as B0."
}
```

The next stage (`beats`) creates a per-post container with a `Beats — <Post Title>` doc, runs the query-first beat extraction (3-pass for short/announcement, 5-pass for long/tutorial), and locks title + preview + slug as B0 commitments. After beats lock, `draft` mode pours the prose.

## Anti-patterns

- ❌ Returning a single topic ("Here's what I think you should write"). Brainstorm = options.
- ❌ More than 5 ideas. Quality over volume.
- ❌ Drafting the full post inside the brainstorm doc. Separate per-post container for beats + draft.
- ❌ Extracting beats inside the brainstorm doc. Brainstorm is topic ideation only; beats live in their own doc inside a per-post container.
- ❌ Skipping the `## Blog` config read — project terminology and category matter from the first idea.
