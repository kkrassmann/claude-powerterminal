# Phase 8: Project Configuration Audit - Context

**Gathered:** 2026-02-28
**Status:** Ready for planning

<domain>
## Phase Boundary

One-click audit of Claude Code project configuration files. Evaluates CLAUDE.md, skills, agent configs, and MCP server configs against a structured best-practice checkliste. Shows per-file quality scores, an overall score with improvement potential, and actionable fix recommendations. The audit prompt lives as an external .md file that can be iterated without code changes.

</domain>

<decisions>
## Implementation Decisions

### Audit-Trigger & Ordnerauswahl
- Audit lebt als Sektion/Tab im bestehenden Analyse-Panel (nicht eigenes Panel)
- Projekt wird aus Dropdown bekannter Claude-Projekte gewahlt (aus ~/.claude/projects/)
- Manueller Start per Button innerhalb der Audit-Sektion, kein Auto-Run
- Ergebnisse werden gecached bis zum nachsten manuellen Trigger
- Dual-Transport: IPC fur Electron + HTTP-Endpoint fur Remote-Browser

### Ergebnisdarstellung
- Datei-Liste mit Score pro Datei (0-100), expandierbar fur Details
- Gesamtscore prominent angezeigt + Improvement Potential als Subtext
- Detail-Ansicht pro Datei: Findings mit Severity + konkretem Fix-Vorschlag
- Severity-Farben: gleiches 5-Stufen-System wie Session-Recommendations (praise/tip/warning/anti-pattern/achievement)

### Audit-Prompt Architektur
- Externe .md Datei im Projekt (z.B. electron/analysis/audit-prompt.md)
- Versioniert in Git, zur Laufzeit gelesen
- Strukturierte Checkliste (maschinen-parsebar): Kategorie, Regel-ID, Pattern, Severity, Fix-Text
- Lokale Heuristiken — kein LLM-API-Call, deterministisch, schnell
- Dateien werden inhaltlich gelesen und bewertet, nicht nur Metadaten

### Bewertungskriterien
- 4 Dateitypen: CLAUDE.md, Skills, Agent Configs, MCP Server Configs
- CLAUDE.md: Struktur + Inhalt (Sektionen vorhanden, Anweisungen spezifisch, Laenge angemessen, keine Widersprueche)
- Skills: Klare Trigger, sinnvolle Beschreibungen, korrekte Syntax
- Agent Configs: Rollen klar, Tools sinnvoll eingeschrankt, Prompts praezise
- MCP Configs: Referenzierte Server konfiguriert, Konfigurationen vollstaendig
- Feste Regeln in der .md Datei, keine Plugin-Erweiterbarkeit
- Einzelbewertung pro Projekt, kein Projekt-Vergleich

### Claude's Discretion
- Genaue Regel-IDs und Pattern-Definitionen in der Checkliste
- Gewichtung der einzelnen Kategorien fur den Gesamtscore
- Layout-Details der Audit-Sektion im Analyse-Panel
- Cache-TTL fur Audit-Ergebnisse

</decisions>

<specifics>
## Specific Ideas

- Severity-System konsistent mit Phase 7 Session-Recommendations halten
- Audit-Prompt als strukturierte Checkliste (nicht Prosa) damit Heuristiken sie deterministisch parsen koennen
- Projekt-Dropdown nutzt die gleiche Datenquelle wie die bestehende Session-Analyse (~/.claude/projects/)

</specifics>

<deferred>
## Deferred Ideas

- Projekt-Vergleiche (mehrere Projekte nebeneinander bewerten)
- Custom Rules Plugin-System (User eigene Regeln ablegen)
- LLM-basierte semantische Analyse als optionale Erweiterung

</deferred>

---

*Phase: 08-project-configuration-audit*
*Context gathered: 2026-02-28*
