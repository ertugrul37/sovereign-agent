import type { MessageKey } from './en';

export const fr: Record<MessageKey, string> = {
  'ui.title': 'Sovereign Agent',
  'ui.placeholder': 'Posez une question sur votre code… (Entrée pour envoyer, Maj+Entrée pour une nouvelle ligne)',
  'ui.send': 'Envoyer',
  'ui.stop': 'Arrêter',
  'ui.you': 'Vous',
  'ui.agent': 'Agent',
  'ui.emptyTitle': 'Votre code reste sur votre machine.',
  'ui.emptyBody': 'Sovereign Agent ne parle qu’à un modèle local. Pas de cloud, pas de télémétrie.',
  'ui.noModel': 'Aucun modèle sélectionné',
  'ui.changeModel': 'Changer de modèle',
  'ui.working': 'En cours…',
  'ui.toolOutput': 'Sortie',
  'ui.history': 'Historique Git',
  'ui.timeline': 'Chronologie',
  'ui.close': 'Fermer',
  'ui.response': 'Réponse',
  'ui.tokens': 'Jetons',
  'ui.speed': 'Vitesse',
  'ui.memory': 'RAM',
  'ui.memoryUnavailable': 'Indisponible',
  'ui.loadingHistory': 'Lecture de l’historique Git local…',
  'ui.noHistory': 'Aucun historique Git dans cet espace.',
  'ui.historyHint': 'Sélectionnez un commit pour voir son résumé.',
  'ui.undo': 'Annuler la dernière modification',
  'ui.performance': 'Performances',
  'ui.live': 'En direct',
  'ui.durationHint': 'de bout en bout',
  'ui.tokenHint': 'invite / réponse',
  'ui.speedHint': 'vitesse de génération',
  'ui.memoryHint': 'état d’exécution',
  'ui.trend': 'Tendance récente',
  'ui.chartSpeed': 'vitesse',
  'ui.chartDuration': 'durée',

  'approval.write': 'Autoriser l’agent à écrire dans « {path} » ?',
  'approval.writeDetail': '{bytes} octets seront écrits.',
  'approval.command': 'Autoriser l’agent à exécuter cette commande ?',
  'approval.replace': 'Autoriser l’agent à modifier « {path} » ?',
  'approval.replaceDetail': 'Seul le texte correspondant exactement sera remplacé.',
  'approval.allow': 'Autoriser',
  'approval.deny': 'Refuser',

  'error.notLocal': 'Connexion refusée vers une adresse non locale : {url}. Sovereign Agent ne parle qu’à des modèles locaux. Utilisez localhost ou activez sovereignAgent.allowLanHosts pour une machine de votre réseau local.',
  'error.connection': 'Impossible de joindre le serveur de modèles à {url}. Ollama, llama.cpp ou LM Studio sont-ils lancés ?',
  'error.http': 'Le serveur de modèles a renvoyé une erreur ({status}) : {detail}',
  'error.noModel': 'Aucun modèle sélectionné. Choisissez d’abord un modèle local.',
  'error.emptyResponse': 'Le modèle a renvoyé une réponse vide.',
  'error.maxIterations': 'Arrêté après {count} étapes. Envoyez un message pour continuer.',
  'error.invalidUrl': 'Adresse de serveur invalide : {url}',
  'editor.noSelection': 'Sélectionnez d’abord du code dans l’éditeur actif.',

  'model.pickPlaceholder': 'Sélectionnez un modèle local',
  'model.noneFound': 'Aucun modèle trouvé sur le serveur. Téléchargez ou chargez-en un d’abord.',
  'model.set': 'Modèle défini sur {model}.',
  'history.noWorkspace': 'Ouvrez un espace pour consulter l’historique Git.',
  'history.unavailable': 'L’historique Git est indisponible.',
  'history.invalidCommit': 'Identifiant de commit invalide.'
  ,'approval.mcp': 'Autoriser le démarrage du serveur MCP local ?'
  ,'approval.applyChange': 'Appliquer la modification à « {path} » ?'
  ,'approval.applyChangeDetail': 'Vérifiez le diff avant de confirmer.'
  ,'checkpoint.none': 'Aucune modification à annuler.'
  ,'checkpoint.restored': '{path} restauré.'
  ,'checkpoint.preview': 'Aperçu de la modification'
};
