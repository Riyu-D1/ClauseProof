# ClauseProof agent rules
- Product: ClauseProof. Reads TM alerts + evidence, outputs CLOSE / RFI / ESCALATE with reason_code, 2-4 sentence reason and evidence IDs, in the exact format of docs/HACKATHON_README.md.
- Scoring: wrong CLOSE (case needed RFI/ESCALATE) costs 10; RFI/ESCALATE on a closable case costs 3. Run 5x on 800 unseen cases from the same 4 institutions. Must be 100% reproducible.
- Build for the POLICY.md principles, never memorise dev-set wording or IDs.
- Never print, commit or log .env or API keys. Never commit institutions/ (dataset).
- No invented metrics. Anything not computed from real runs must be labelled as example data.
- Work only in your own worktree and branch. Push your branch and open a PR with gh pr create. NEVER merge.
