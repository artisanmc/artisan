-- P6c (ADR `assets-on-server-disk`) : les assets vivent sur le disque des
-- serveurs, plus rien ne lit cette table. Elle part.
--
-- Le DROP est GARDÉ, et le garde n'est pas de la superstition : si une ligne
-- subsistait, elle appartiendrait à un Project dont la descente n'a jamais
-- tourné, et la supprimer serait irréversible. Dans ce cas on garde la table et
-- on le dit dans les logs — le code, lui, ne la lit plus depuis P6a, donc
-- personne ne s'appuiera dessus par accident.
--
-- On n'échoue JAMAIS : l'entrypoint du conteneur boucle sur `db:migrate`
-- (`until bun run db:migrate; do sleep 3; done`), donc une migration qui lève
-- empêcherait le backend de démarrer, indéfiniment. Perdre la suppression est
-- rattrapable ; perdre la prod ne l'est pas.
DO $$
DECLARE
	remaining bigint;
BEGIN
	SELECT count(*) INTO remaining FROM assets;
	IF remaining = 0 THEN
		DROP TABLE assets;
		RAISE NOTICE 'assets: table vide, supprimée';
	ELSE
		RAISE WARNING 'assets: % ligne(s) restante(s) — table CONSERVÉE. Rejouer la descente (git revert de P6c) avant de supprimer.', remaining;
	END IF;
END $$;
