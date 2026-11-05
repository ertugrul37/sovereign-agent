import type { MessageKey } from './en';

export const de: Record<MessageKey, string> = {
  'ui.title': 'Sovereign Agent',
  'ui.placeholder': 'Wie kann ich dir heute helfen?',
  'ui.send': 'Senden',
  'ui.stop': 'Stopp',
  'ui.you': 'Du',
  'ui.agent': 'Agent',
  'ui.emptyTitle': 'Dein Code bleibt auf deinem Rechner.',
  'ui.emptyBody': 'Sovereign Agent spricht nur mit einem lokalen Modell. Keine Cloud, keine Telemetrie.',
  'ui.noModel': 'Kein Modell ausgewählt',
  'ui.changeModel': 'Modell wechseln',
  'ui.working': 'Arbeitet…',
  'ui.toolOutput': 'Ausgabe',
  'ui.history': 'Git-Verlauf',
  'ui.timeline': 'Zeitleiste',
  'ui.close': 'Schließen',
  'ui.response': 'Antwort',
  'ui.tokens': 'Token',
  'ui.speed': 'Geschwindigkeit',
  'ui.memory': 'RAM',
  'ui.memoryUnavailable': 'Nicht verfügbar',
  'ui.loadingHistory': 'Lokalen Git-Verlauf lesen…',
  'ui.noHistory': 'Kein Git-Verlauf in diesem Arbeitsbereich.',
  'ui.historyHint': 'Commit für eine Zusammenfassung auswählen.',
  'ui.undo': 'Letzte Änderung rückgängig machen',
  'ui.performance': 'Leistung',
  'ui.live': 'Live',
  'ui.durationHint': 'Ende zu Ende',
  'ui.tokenHint': 'Prompt / Antwort',
  'ui.speedHint': 'Generierungsrate',
  'ui.memoryHint': 'Laufzeitstatus',
  'ui.trend': 'Letzter Antworttrend',
  'ui.chartSpeed': 'Geschwindigkeit',
  'ui.chartDuration': 'Dauer',
  'ui.compareModel': 'Zweites Vergleichsmodell auswählen',
  'ui.compareTitle': 'Antworten vergleichen',
  'ui.compareRunning': 'Beide Modelle antworten…',
  'ui.compareChoose': 'Antwort zum Behalten auswählen',
  'ui.compareReady': 'Bereit',
  'ui.compareError': 'Fehlgeschlagen',
  'ui.chooseAnswer': 'Diese Antwort verwenden',
  'ui.searchModels': 'Modelle suchen',
  'ui.configureCompare': 'Vergleichsmodell konfigurieren…',
  'ui.dictation': 'Diktat',
  'ui.dictationHint': 'Sprechen Sie, und der Text wird eingefügt. Vor dem Senden kann er bearbeitet werden.',
  'ui.defaultMicrophone': 'Mikrofon (Systemstandard)',
  'ui.listening': 'Zuhören…',
  'ui.dictationUnavailable': 'Spracherkennung ist in diesem Webview nicht verfügbar.',
  'ui.dictationError': 'Mikrofoneingabe fehlgeschlagen.',
  'ui.attach': 'Kontext hinzufügen',
  'ui.autoApprove': 'Auto Free',
  'ui.approvalHint': 'Automatische Genehmigung ist deaktiviert. Klicken Sie, um Berechtigungsanfragen automatisch zu genehmigen.',
  'ui.approveNext': 'Nächste Anfrage genehmigen',
  'ui.approvalEnabled': 'Genehmigung aktiviert',
  'ui.modeCode': 'Der Standardagent. Führt Tools nach den konfigurierten Berechtigungen aus.',
  'ui.modeAsk': 'Antworten und Erklärungen ohne Änderungen geben.',
  'ui.modeDebug': 'Softwareprobleme systematisch diagnostizieren und beheben.',
  'ui.modeOrchestrator': 'Komplexe Aufgaben durch parallele Schritte koordinieren.',
  'ui.modePlan': 'Planmodus. Nur Plan-Dateien bearbeiten; andere Änderungen sind gesperrt.',
  'ui.deprecated': 'veraltet',
  'ui.noModels': 'Keine lokalen Modelle gefunden.',
  'ui.asrSettings': 'ASR-Einstellungen',
  'ui.transcribing': 'Lokale ASR transkribiert…',
  'ui.recording': 'Aufnahme… erneut klicken zum Transkribieren',

  'approval.write': 'Dem Agenten erlauben, "{path}" zu schreiben?',
  'approval.writeDetail': '{bytes} Bytes werden geschrieben.',
  'approval.command': 'Dem Agenten erlauben, diesen Befehl auszuführen?',
  'approval.replace': 'Dem Agenten erlauben, "{path}" zu bearbeiten?',
  'approval.replaceDetail': 'Nur der exakt passende Text wird ersetzt.',
  'approval.allow': 'Erlauben',
  'approval.deny': 'Ablehnen',

  'error.notLocal': 'Verbindung zu einer nicht lokalen Adresse abgelehnt: {url}. Sovereign Agent spricht nur mit lokalen Modellen. Nutze localhost oder aktiviere sovereignAgent.allowLanHosts für einen Rechner im lokalen Netz.',
  'error.connection': 'Der Modellserver unter {url} ist nicht erreichbar. Laufen Ollama, llama.cpp oder LM Studio?',
  'error.http': 'Der Modellserver meldet einen Fehler ({status}): {detail}',
  'error.noModel': 'Kein Modell ausgewählt. Wähle zuerst ein lokales Modell.',
  'error.emptyResponse': 'Das Modell hat eine leere Antwort geliefert.',
  'error.emptyTranscription': 'Der ASR-Server gab keine Transkription zurück.',
  'error.invalidAudio': 'Ungültige Mikrofonaufnahme.',
  'error.maxIterations': 'Nach {count} Schritten gestoppt. Sende eine Nachricht, um fortzufahren.',
  'error.invalidUrl': 'Ungültige Serveradresse: {url}',
  'editor.noSelection': 'Wähle zuerst Code im aktiven Editor aus.',

  'model.pickPlaceholder': 'Lokales Modell auswählen',
  'model.comparePickPlaceholder': 'Zweites Vergleichsmodell auswählen',
  'model.compareSet': 'Vergleichsmodell auf {model} gesetzt.',
  'model.compareDisabled': 'Modellvergleich deaktiviert.',
  'model.noneFound': 'Keine Modelle auf dem Server gefunden. Lade zuerst ein Modell.',
  'model.set': 'Modell auf {model} gesetzt.',
  'history.noWorkspace': 'Arbeitsbereich öffnen, um den Git-Verlauf zu sehen.',
  'history.unavailable': 'Git-Verlauf ist nicht verfügbar.',
  'history.invalidCommit': 'Ungültige Commit-ID.'
  ,'approval.mcp': 'Starten des lokalen MCP-Servers erlauben?'
  ,'approval.applyChange': 'Änderung an "{path}" anwenden?'
  ,'approval.applyChangeDetail': 'Diff vor der Bestätigung prüfen.'
  ,'checkpoint.none': 'Keine Änderung zum Rückgängigmachen.'
  ,'checkpoint.restored': '{path} wiederhergestellt.'
  ,'checkpoint.preview': 'Änderungsvorschau'
  ,'ui.greetingMorning': 'Guten Morgen'
  ,'ui.greetingAfternoon': 'Guten Tag'
  ,'ui.greetingEvening': 'Guten Abend'
  ,'ui.modeChat': 'Chat'
  ,'ui.modeAgent': 'Agent'
  ,'ui.chipCode': 'Code'
  ,'ui.chipLearn': 'Lernen'
  ,'ui.chipWrite': 'Schreiben'
  ,'ui.chipDebug': 'Debuggen'
  ,'ui.chipPlan': 'Planen'
  ,'ui.starterCode': 'Baue in diesem Projekt: '
  ,'ui.starterLearn': 'Erkläre mir: '
  ,'ui.starterWrite': 'Schreibe eine Dokumentation für: '
  ,'ui.starterDebug': 'Finde und behebe diesen Fehler: '
  ,'ui.starterPlan': 'Erstelle einen Schritt-für-Schritt-Plan für: '
  ,'ui.menuAttach': 'Dateien oder Fotos hinzufügen'
  ,'ui.menuProject': 'Zum Projekt hinzufügen'
  ,'ui.menuSkills': 'Skills'
  ,'ui.menuConnectors': 'Konnektor hinzufügen'
  ,'ui.menuDesign': 'Designsystem'
  ,'ui.menuExtension': 'Erweiterung hinzufügen'
  ,'ui.menuWebSearch': 'Websuche'
  ,'ui.soon': 'Bald'
  ,'ui.projectActiveFile': 'Geöffnete Datei hinzufügen'
  ,'ui.projectPickFile': 'Dateien aus dem Arbeitsbereich wählen…'
  ,'ui.projectSelection': 'Markierten Code hinzufügen'
  ,'ui.skillsEmpty': 'Keine Prompts in .github/prompts gefunden'
  ,'ui.skillsLoading': 'Wird geladen…'
  ,'ui.connectorsOpen': 'MCP-Server konfigurieren…'
  ,'ui.themeAuto': 'VS-Code-Design'
  ,'ui.themeDark': 'Dunkel'
  ,'ui.themeLight': 'Hell'
  ,'ui.back': 'Zurück'
  ,'ui.removeAttachment': 'Anhang entfernen'
  ,'ui.imageUnsupported': 'Bilder können noch nicht an das Modell gesendet werden. Hänge eine Text- oder Codedatei an.'
  ,'ui.attachUnsupported': '{name} konnte nicht angehängt werden: Die Datei ist binär oder größer als 512 KB.'
  ,'ui.noActiveFile': 'Keine Datei geöffnet.'
  ,'ui.feedback': 'Support & Feedback'
  ,'ui.feedbackTitle': 'Support & Feedback'
  ,'ui.feedbackDesc': 'Haben Sie einen Funktionswunsch, eine Frage oder einen Fehlerbericht? Senden Sie Ihre Anfrage direkt an unser Team:'
  ,'ui.feedbackPlaceholder': 'Beschreiben Sie Ihre Anfrage, Ihr Problem oder Ihren Vorschlag hier...'
  ,'ui.sendEmail': 'Per E-Mail senden'
  ,'ui.copyEmail': 'E-Mail kopieren'
  ,'ui.emailCopied': 'Kopiert!'
  ,'ui.openEmailClient': 'Im E-Mail-Programm öffnen'
  ,'ui.menuLanguage': 'Sprache'
  ,'ui.languageAuto': 'Automatisch (VS Code)'
  ,'ui.openSettings': 'Einstellungen'
  ,'ui.copyCode': 'Kopieren'
  ,'ui.insertCode': 'Einfügen'
  ,'ui.runCode': 'Ausführen'
  ,'ui.webSearch': 'Websuche'
  ,'ui.livePreview': 'Live-Webvorschau & Tester'
  ,'ui.graphify': 'Graphify Wissensgraph (Knowledge Graph)'
  ,'ui.rateExtension': 'Im Marketplace mit 5 Sternen bewerten ⭐'
  ,'ui.starGithub': 'Auf GitHub markieren ★'
  ,'ui.rateDesc': 'Gefällt Ihnen 100 % lokaler Datenschutz? Eine 5-Sterne-Bewertung hilft anderen Entwicklern, Sovereign Agent zu entdecken!'
  ,'review.prompt': 'Gefällt Ihnen Sovereign Agent? Eine kurze Bewertung im VS Code Marketplace hilft anderen datenschutzbewussten Entwicklern!'
  ,'review.rateNow': '5 Sterne geben ⭐'
  ,'review.starGithub': 'Auf GitHub ★'
  ,'review.later': 'Später'
  ,'ui.exportChat': 'Chat exportieren'
  ,'ui.exportChatTitle': 'Gesamten Chat-Verlauf exportieren'
  ,'ui.exportMarkdown': 'Als Markdown speichern (.md)'
  ,'ui.exportJson': 'Als JSON speichern (.json)'
  ,'ui.exportClipboard': 'In Zwischenablage kopieren'
  ,'ui.exportEditor': 'In neuem Tab öffnen'
  ,'ui.exportEmpty': 'Kein Chat-Verlauf zum Exportieren vorhanden.'
  ,'ui.exportCopied': '✓ Chat-Protokoll in die Zwischenablage kopiert!'
  ,'ui.exportSaved': '✓ Chat-Export in {file} gespeichert'
  ,'ui.exportPdf': 'Als PDF speichern (.pdf)'
  ,'ui.exportPdfDesc': 'Erstellt ein exaktes PDF im Chat-Design'
  ,'ui.exportPdfSaved': '✓ Chat als PDF in {file} gespeichert'
  ,'ui.openFile': 'Datei öffnen'
};
