# UI-04 compact Settings categories

Issue: [#60](https://github.com/iNewTech/iMonitor/issues/60)
Design contract: [UI_DESIGN.md](../../UI_DESIGN.md)
Project: [AI + ActionBoard](https://github.com/orgs/iNewTech/projects/8)

The Settings page now uses seven compact categories: **General**, **Monitoring**, **AI & knowledge**, **Integrations**, **Skills & MCP**, **Access**, and **Storage**. Selecting a category hides the others and keeps existing feature panels available through their current focused sections.

General provides theme saving and connection context. Monitoring keeps alerts and business mappings. Storage links to the existing collector and retention controls so data is managed in one place. Skills & MCP is an honest empty state reserved for the AI + ActionBoard skills registry. Installed and available integrations retain their existing configuration and entitlement behavior.

The focused Electron settings suite covers category visibility, seven navigation controls, theme persistence, draft value preservation while switching categories, the Storage-to-collector route, existing integration setup, background collection, business mappings, Premium previews, and support access.

The suite uses isolated demo data. It demonstrates layout and interaction only; it is not evidence of live IBM i access or external integration deployment.
