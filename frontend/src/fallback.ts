// Bundled copy of the prototype content. It is ONLY used when the site is built with VITE_STATIC_FALLBACK=true
// (an explicit, optional demo mode for previewing the frontend without a backend). By default, if the API cannot
// be reached the public pages show an error message instead of silently serving stale content.
export const STATIC_FALLBACK = import.meta.env.VITE_STATIC_FALLBACK === 'true'
export const news = [
  { id: 1, category: 'Réseau', title: 'Le NOC Point G est désormais opérationnel', date: '12 février 2026', text: 'Une infrastructure nationale au service de la recherche et de l’éducation.' },
  { id: 2, category: 'Partenariat', title: 'Convention de collaboration avec Afribone', date: '28 janvier 2026', text: 'Une nouvelle étape pour renforcer l’interconnexion des établissements membres.' },
  { id: 3, category: 'Formation', title: 'Ateliers eduroam pour les campus pilotes', date: '22 octobre 2025', text: 'Formation technique et déploiement dans les établissements pilotes.' },
]
export const events = [
  { status: 'À VENIR  2026', title: 'Convention Afribone  MoU 2026', date: 'Janvier 2026 · Signature du protocole de collaboration', text: 'Renforcement du partenariat pour l’interconnexion et la recherche au Mali  coopération & infrastructures et accès fédéré.' },
  { status: 'À VENIR  2025', title: 'Lancement pilotes Zoom', date: '15 décembre 2025 · Déploiement pilote visioconférence pour établissements membres', text: 'Tests des salles virtuelles sécurisées Zoom pour l’enseignement à distance et réunions techniques.' },
  { status: 'Passé', title: 'Ateliers eduroam 2025', date: '22–24 octobre 2025 · Atelier technique et déploiement', text: 'Formation des administrateurs locaux à la fédération EduID et gestion des accès académiques.' },
  { status: 'PASSÉ  2025', title: 'Ateliers eduroam 2025', date: '22–24 octobre 2025 · Atelier technique et déploiement', text: 'Sessions pratiques sur le déploiement eduroam dans les campus universitaires de Bamako.' },
  { status: '', title: 'Formation EduID', date: '10 septembre 2025 · Formation à l’identité électronique', text: 'Formation des administrateurs locaux à la fédération EduID et gestion des accès académiques.' },
  { status: 'PASSÉ  2025', title: 'Journées NOC  Point G inauguration MLIX', date: '05 juillet 2025 · Inauguration du Point d’échange Internet MLIX', text: 'Inauguration du Mali Internet Exchange (MLIX) au Point G, FMOS  échanges techniques et démonstrations NOC.' },
]
