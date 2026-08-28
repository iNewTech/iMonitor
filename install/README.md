# Installers

This folder is the clean handoff area for user-facing installer files.

Use:

```bash
npm run package:release
```

That flow will:

1. build installers into `release/`
2. copy only `.dmg` and `.exe` files into this `install/` folder

Commit the files in this folder when you want the repo to carry the current release installers.
