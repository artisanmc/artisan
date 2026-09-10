export const migrationEn = {
	applyAll: "Apply available results",
	title: "Menu migration",
	exploreHelp:
		"The AI explores the selected files, identifies menus and dependencies, then prepares Artisan proposals. No source plugin is imposed.",
	exploring: "Exploring sources and planning the migration…",
	explorationReport: "Source findings and limitations",
	selection: "Migrate this selection",
	loading: "Loading migrations…",
	working: "Working…",
	analyzeHelp:
		"Keep the complete selection. Artisan indexes links, then converts one menu at a time. Analysis does not call the AI.",
	budget: "Accepted budget (credits)",
	budgetHelp:
		"Exploration and conversion use network credits. You can pause and resume; it stops when credits run out.",
	analyze: "Analyze selection",
	history: "Previous migrations",
	menus: "menus",
	start: "Start migration",
	resume: "Resume migration",
	compress: "Compress and resume",
	compressing: "Compressing the working history…",
	compressionHelp:
		"Generate an AI summary, then resume. This uses credits and may lose details; original files and generated menus remain available.",
	pause: "Pause after this step",
	cancel: "Cancel migration",
	progress:
		"{{generated}} / {{total}} generated · {{applied}} applied to this draft",
	spent: "{{used}} credits used",
	active: "Converting:",
	reanalyze: "Review sources and target names",
	reanalyzeHelp:
		"Review the sources, then start a new migration. Previous results remain available in history; this does not resume the old migration.",
	analyzeAgain: "Restart with current sources",
	draftHelp:
		"Apply results to your local draft, review them, then use Save to update the server. Source files are never changed.",
	apply: "Apply to draft",
	verify: "Review required.",
	storageWarning:
		"The browser cannot preserve your draft. Generated proposals remain available here; save applied changes before leaving.",
	status: {
		analyzing: "Analyzing selection",
		ready: "Ready to start",
		running: "Migration in progress",
		paused: "Paused — resume explicitly",
		blocked: "Selection needs attention",
		completed: "Generation complete — review and apply results",
		cancelled: "Cancelled — existing results kept",
	},
	applyStatus: {
		available: "Generated",
		already_applied: "Applied to this draft",
		conflict: "Local changes — not overwritten",
		blocked: "Cannot apply safely",
	},
	errors: {
		missing_proposal:
			"The AI ended its response without the required tool action. No result was saved for this step.",
		invalid_tool:
			"The AI requested an invalid tool action. This is not a connection failure.",
		invalid_arguments:
			"The AI repeatedly sent invalid action parameters. Migration paused.",
		invalid_offset:
			"The AI repeatedly requested an invalid position in a source file. Migration paused.",
		unselected_source:
			"The AI repeatedly requested a file outside the selection. Access was denied.",
		unknown_tool:
			"The AI repeatedly requested an unavailable tool. Migration paused.",
		mixed_proposal:
			"The AI repeatedly grouped a proposal with other actions. No ambiguous proposal was applied.",
		tool_batch_limit:
			"The AI requested more than 256 tool actions in one response. This step was stopped safely.",
		migration_attempt_limit:
			"The exploration or retry limit was reached. Repeating the same request may fail again; review the sources before starting a new migration.",
		invalid_plan:
			"The exploration plan could not be validated. Review the source selection and target names.",
		source_analysis_incomplete:
			"Automatic source analysis was incomplete. The AI will read the original text; check the repaired syntax and links before saving.",
		migration_error:
			"The operation stopped. Use the interruption code to identify the cause before retrying.",
		invalid_budget:
			"Enter a whole-number budget between 1 and 1,000,000 credits.",
		revision_conflict:
			"The migration changed elsewhere. Its latest state has been loaded; choose the action again.",
		request_conflict:
			"This analysis request changed. Review the selection before trying again.",
		source_changed:
			"A source file changed. Review the sources and create a new analysis.",
		source_missing: "A selected source is no longer available.",
		missing_reference: "A linked source was not selected; review this link.",
		dynamic_reference: "This dynamic link needs manual review.",
		external_reference:
			"This link targets an external plugin and needs review.",
		ambiguous_reference: "Several sources match this link; review it manually.",
		target_collision:
			"Several files use the same target name. Choose unique names below.",
		target_exists: "This target already exists. Choose a different name below.",
		invalid_target_id:
			"Use letters, numbers, underscores or hyphens for the target name.",
		unsupported_source:
			"This file is not recognized as a menu or shared zMenu source.",
		commands_manual_verification:
			"Command bindings must be migrated manually; only menus are generated here.",
		missing_generated_reference:
			"A source link is absent from the generated menu. Review it before saving.",
		provider_timeout:
			"The AI stopped responding or its provider timed out. Completed menus are retained; resume with the button or ask the assistant to continue.",
		provider_network_error:
			"The connection to the AI was interrupted. Completed menus are retained.",
		provider_error:
			"The AI returned an unusable response. Completed menus are retained.",
		provider_output_limit:
			"The provider stopped generation at its output limit. The incomplete response was not applied; completed menus are retained.",
		response_buffer_exceeded:
			"The response exceeded Artisan's memory safety limit. It was not applied; completed menus are retained.",
		context_budget_exceeded:
			"An earlier version stopped at Artisan's local context limit. Resume to use the provider's actual limit.",
		provider_context_full:
			"The API reports that the context is full. Compress the working history to resume.",
		compression_failed:
			"The summary could not be completed or did not reduce the history. The previous state is preserved.",
		compression_required: "Use Compress and resume to reduce this history.",
		compression_unavailable:
			"There is no saved context to compress for this step.",
		migration_budget_exceeded:
			"The accepted budget is exhausted. Existing results remain available.",
		step_budget_exceeded:
			"The per-menu budget was reached. Completed results remain available.",
		insufficient_credits: "There are not enough credits to continue.",
		lease_expired:
			"The previous worker stopped. Resume explicitly to continue.",
		model_unavailable: "The selected model is unavailable.",
		project_scope_changed:
			"The Project moved to another server or network. Open it again.",
		forbidden: "You no longer have access to this Project.",
		conflict:
			"Local changes conflict with this result. Nothing was overwritten.",
		blocked: "This result cannot be applied safely.",
		invalid_menu: "The generated menu could not be validated.",
		import_server_offline: "The server must be online to read these sources.",
		server_offline: "The server must be online to read these sources.",
	},
};
export const migrationFr = {
	applyAll: "Appliquer les résultats disponibles",
	title: "Migration de menus",
	exploreHelp:
		"L’IA explore les fichiers sélectionnés, identifie les menus et leurs dépendances, puis prépare les propositions Artisan. Aucun plugin source n’est imposé.",
	exploring: "Exploration des sources et préparation de la migration…",
	explorationReport: "Sources examinées et limites de conversion",
	selection: "Migrer cette sélection",
	loading: "Chargement des migrations…",
	working: "Opération en cours…",
	analyzeHelp:
		"Gardez toute la sélection. Artisan indexe les liens, puis convertit un menu à la fois. L’analyse ne fait pas appel à l’IA.",
	budget: "Budget accepté (crédits)",
	budgetHelp:
		"L’exploration et la conversion consomment les crédits du réseau. Vous pouvez mettre en pause et reprendre ; elle s’arrête lorsque le solde est épuisé.",
	analyze: "Analyser la sélection",
	history: "Migrations précédentes",
	menus: "menus",
	start: "Démarrer la migration",
	resume: "Reprendre la migration",
	compress: "Compresser et reprendre",
	compressing: "Compression de l’historique de travail…",
	compressionHelp:
		"Génère un résumé IA puis reprend. Cela consomme des crédits et peut perdre des détails ; les fichiers originaux et menus générés restent disponibles.",
	pause: "Pause après cette étape",
	cancel: "Annuler la migration",
	progress:
		"{{generated}} / {{total}} générés · {{applied}} appliqués à ce brouillon",
	spent: "{{used}} crédits consommés",
	active: "Conversion :",
	reanalyze: "Revoir les sources et les noms de destination",
	reanalyzeHelp:
		"Vérifiez les sources, puis démarrez une nouvelle migration. Les résultats précédents restent dans l’historique ; cela ne reprend pas l’ancienne migration.",
	analyzeAgain: "Recommencer avec les sources actuelles",
	draftHelp:
		"Appliquez les résultats au brouillon local, vérifiez-les, puis utilisez Enregistrer pour modifier le serveur. Les fichiers sources ne sont jamais modifiés.",
	apply: "Appliquer au brouillon",
	verify: "À vérifier.",
	storageWarning:
		"Le navigateur ne peut pas conserver votre brouillon. Les propositions générées restent disponibles ici ; enregistrez les changements appliqués avant de partir.",
	status: {
		analyzing: "Analyse de la sélection",
		ready: "Prêt à démarrer",
		running: "Migration en cours",
		paused: "En pause — reprise manuelle",
		blocked: "Sélection à corriger",
		completed: "Génération terminée — vérifiez et appliquez les résultats",
		cancelled: "Annulée — résultats existants conservés",
	},
	applyStatus: {
		available: "Généré",
		already_applied: "Appliqué à ce brouillon",
		conflict: "Modifications locales — aucun écrasement",
		blocked: "Application bloquée par sécurité",
	},
	errors: {
		missing_proposal:
			"L’IA a terminé sa réponse sans effectuer l’action attendue. Aucun résultat n’a été enregistré pour cette étape.",
		invalid_tool:
			"L’IA a demandé une action invalide. Ce n’est pas une erreur de connexion.",
		invalid_arguments:
			"L’IA a envoyé plusieurs fois des paramètres d’action invalides. Migration en pause.",
		invalid_offset:
			"L’IA a demandé plusieurs fois une position invalide dans un fichier source. Migration en pause.",
		unselected_source:
			"L’IA a demandé plusieurs fois un fichier hors de la sélection. L’accès a été refusé.",
		unknown_tool:
			"L’IA a demandé plusieurs fois un outil indisponible. Migration en pause.",
		mixed_proposal:
			"L’IA a regroupé plusieurs fois une proposition avec d’autres actions. Aucune proposition ambiguë n’a été appliquée.",
		tool_batch_limit:
			"L’IA a demandé plus de 256 actions dans une seule réponse. L’étape a été arrêtée par sécurité.",
		migration_attempt_limit:
			"La limite d’exploration ou de tentatives est atteinte. Reprendre à l’identique risque de répéter l’échec ; vérifiez les sources avant une nouvelle migration.",
		invalid_plan:
			"Le plan d’exploration n’a pas pu être validé. Vérifiez la sélection et les noms de destination.",
		source_analysis_incomplete:
			"L’analyse automatique du fichier est incomplète. L’IA lira le texte original ; vérifiez la syntaxe réparée et les liens avant d’enregistrer.",
		migration_error:
			"L’opération s’est arrêtée. Le code d’interruption permet d’identifier la cause avant de réessayer.",
		invalid_budget: "Saisissez un budget entier entre 1 et 1 000 000 crédits.",
		revision_conflict:
			"La migration a changé ailleurs. Son dernier état a été chargé ; choisissez à nouveau l’action.",
		request_conflict:
			"La demande d’analyse a changé. Vérifiez la sélection avant de réessayer.",
		source_changed:
			"Un fichier source a changé. Vérifiez les sources puis créez une nouvelle analyse.",
		source_missing: "Un fichier sélectionné n’est plus accessible.",
		missing_reference:
			"Une source liée n’est pas sélectionnée ; vérifiez ce lien.",
		dynamic_reference: "Ce lien dynamique doit être vérifié manuellement.",
		external_reference: "Ce lien vise un plugin externe et doit être vérifié.",
		ambiguous_reference:
			"Plusieurs sources correspondent à ce lien ; vérifiez-le manuellement.",
		target_collision:
			"Plusieurs fichiers ont le même nom de destination. Choisissez des noms uniques ci-dessous.",
		target_exists:
			"Cette destination existe déjà. Choisissez un autre nom ci-dessous.",
		invalid_target_id:
			"Utilisez lettres, chiffres, tirets ou underscores pour le nom de destination.",
		unsupported_source:
			"Ce fichier n’est pas reconnu comme menu ou source partagée zMenu.",
		commands_manual_verification:
			"Les commandes doivent être migrées manuellement ; seuls les menus sont générés ici.",
		missing_generated_reference:
			"Un lien source est absent du menu généré. Vérifiez-le avant d’enregistrer.",
		provider_timeout:
			"L’IA ne répond plus ou son fournisseur a expiré le délai d’attente. Les menus terminés sont conservés ; utilisez le bouton de reprise ou demandez à l’assistant de continuer.",
		provider_network_error:
			"La connexion à l’IA a été interrompue. Les menus terminés sont conservés.",
		provider_error:
			"L’IA a renvoyé une réponse inutilisable. Les menus terminés sont conservés.",
		provider_output_limit:
			"Le fournisseur a arrêté la génération à sa limite de sortie. La réponse incomplète n’a pas été appliquée ; les menus terminés sont conservés.",
		response_buffer_exceeded:
			"La réponse dépasse la limite de sécurité mémoire d’Artisan. Elle n’a pas été appliquée ; les menus terminés sont conservés.",
		context_budget_exceeded:
			"Une ancienne version s’est arrêtée sur la limite locale d’Artisan. Reprenez pour utiliser la limite réelle du fournisseur.",
		provider_context_full:
			"L’API indique que le contexte est plein. Compressez l’historique de travail pour reprendre.",
		compression_failed:
			"Le résumé n’a pas abouti ou n’a pas réduit l’historique. L’état précédent est conservé.",
		compression_required:
			"Utilisez Compresser et reprendre pour réduire cet historique.",
		compression_unavailable:
			"Aucun contexte sauvegardé n’est disponible à compresser pour cette étape.",
		migration_budget_exceeded:
			"Le budget accepté est épuisé. Les résultats existants restent disponibles.",
		step_budget_exceeded:
			"Le budget par menu a été atteint. Les résultats terminés restent disponibles.",
		insufficient_credits: "Il n’y a pas assez de crédits pour continuer.",
		lease_expired:
			"Le traitement précédent s’est arrêté. Reprenez manuellement pour continuer.",
		model_unavailable: "Le modèle sélectionné n’est pas disponible.",
		project_scope_changed:
			"Le Project a changé de serveur ou de réseau. Ouvrez-le à nouveau.",
		forbidden: "Vous n’avez plus accès à ce Project.",
		conflict:
			"Des modifications locales sont en conflit avec ce résultat. Rien n’a été écrasé.",
		blocked: "Ce résultat ne peut pas être appliqué en toute sécurité.",
		invalid_menu: "Le menu généré n’a pas pu être validé.",
		import_server_offline:
			"Le serveur doit être en ligne pour lire ces sources.",
		server_offline: "Le serveur doit être en ligne pour lire ces sources.",
	},
};
