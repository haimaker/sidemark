# Migration plan

We will move every tenant to the new cluster in Q3.

<a id="c-4f9tq1"></a>

```sh
./migrate --all --window 2h
```

<a id="c-4f9tq1-end"></a>

Rollback is manual.

## Comments

| Ref | Quote | Author | Date | Comment | Status |
|---|---|---|---|---|---|
| [c-4f9tq1](#c-4f9tq1) | to the new cluster in Q3. **./migrate --all --window 2h** Rollback is manual. | @sam | 2026-11-17T12:40Z | Is 2h enough for the largest tenant? | |
| [c-9b2hd7](#c-9b2hd7) | **the old cluster stays read-only for a week** | @sam | 2026-11-16T09:05Z | Do we still need this? | |
| c-m3k8za | | @wayne | 2026-11-17T13:00Z | Needs an owner before we circulate it. | |
