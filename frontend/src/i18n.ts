export type Language = 'fr' | 'en'
export const EN:Record<string,string> = {
  'Accueil':'Home','À propos':'About','Événement':'Events','Réalisation':'Achievements','Ressource':'Resources','Partenaires':'Partners',
  'Contact Technique':'Technical Contact','Contact CEO':'CEO Contact','Tous droits réservés':'All rights reserved','Mentions légales':'Legal notice','Politique de confidentialité':'Privacy policy',
  'Accéder à EduID':'Access EduID','Voir les services':'View services','5 sites pilotes connectés':'5 connected pilot sites','Connecté · Opérationnel':'Connected · Operational',
  'À propos de MaliREN':'About MaliREN','Réseau National d’Éducation et de Recherche du Mali':'National Education and Research Network of Mali','Qui sommes-nous ?':'Who are we?','Notre mission':'Our mission',
  'Nos Services':'Our Services','Ressources & Accès':'Resources & Access','Retrouvez les services et outils fournis par MaliREN':'Find the services and tools provided by MaliREN','Instructions d’accès':'Access instructions',
  'Événements':'Events','suivez l’actualité et les activités de MaliREN  à venir et passés':'follow MaliREN news and activities  upcoming and past','À venir':'Upcoming','Passé':'Past',
  'Contactez MaliREN':'Contact MaliREN','Nous sommes à votre disposition pour toute question, partenariat ou demande de connexion':'We are available for any question, partnership or connection request',
  'Informations de contact':'Contact information','Informations réseau':'Network information','Formulaire de contact':'Contact form','Nom complet':'Full name','Objet':'Subject','Message':'Message','Envoyer le message':'Send message',
  'Votre nom et prénom':'Your full name','Sujet de votre demande':'Subject of your request','Décrivez votre demande, question ou besoin...':'Describe your request, question, or need...','Nous répondons généralement sous 24-48h ouvrées.':'We generally reply within 24–48 business hours.',
}
export const FR:Record<string,string> = Object.fromEntries(Object.entries(EN).map(([fr,en])=>[en,fr]))

// Extra strings used by the data-driven pages
Object.assign(EN, {
  'Aucun événement à venir.': 'No upcoming events.', 'Aucun événement passé.': 'No past events.',
  'Aucun contenu disponible pour le moment.': 'No content available at the moment.',
  'Chargement…': 'Loading…', 'Lire l’article': 'Read the article', 'Consulter': 'View',
  'Votre demande a bien été envoyée. Nous vous répondrons sous 24-48h ouvrées.': 'Your request has been sent. We will reply within 24-48 working hours.',
  'Envoi en cours…': 'Sending…', 'Veuillez remplir tous les champs obligatoires.': 'Please fill in all required fields.',
  'Trop de messages envoyés depuis cette adresse. Réessayez plus tard.': 'Too many messages sent from this address. Please try again later.',
  'Le service est momentanément indisponible. Réessayez plus tard.': 'The service is temporarily unavailable. Please try again later.',
  'Contenu introuvable': 'Content not found', 'Retour': 'Back', 'Télécharger': 'Download', 'Visiter le site': 'Visit website',
  'Document': 'Document', 'Aucun résultat.': 'No results.', 'Recherche en cours…': 'Searching…',
})
Object.keys(FR).forEach((k) => delete (FR as Record<string, string>)[k])
Object.entries(EN).forEach(([fr, en]) => { (FR as Record<string, string>)[en] = fr })
