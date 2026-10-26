import { createElement } from 'react'
import type { ModuleCfg } from './ContentManager'
import { fmtDate } from './kit'

const txt = (s: unknown) => createElement('span', null, String(s ?? '') || '')
export const MODULES: Record<string, ModuleCfg> = {
  news: {
    name: 'news', title: 'Actualités', singular: 'une actualité', subtitle: 'Articles du site public', workflow: 'content', titleKey: 'titleFr',
    initial: { category: '', titleFr: '', titleEn: '', excerptFr: '', excerptEn: '', bodyFr: '', bodyEn: '', coverMediaId: null },
    cols: [{ label: 'Catégorie', render: (i) => txt(i.category) }, { label: 'Publiée le', render: (i) => txt(i.publishedAt ? fmtDate(i.publishedAt) : '') }],
    fields: [
      { key: 'category', label: 'Catégorie', type: 'text', max: 60 }, { key: 'coverMediaId', label: 'Image de couverture', type: 'media', mediaKind: 'image' },
      { key: 'titleFr', label: 'Titre (FR)', type: 'text', required: true, max: 200 }, { key: 'titleEn', label: 'Title (EN)', type: 'text', max: 200 },
      { key: 'excerptFr', label: 'Résumé (FR)', type: 'textarea', rows: 2, max: 600 }, { key: 'excerptEn', label: 'Summary (EN)', type: 'textarea', rows: 2, max: 600 },
      { key: 'bodyFr', label: 'Contenu (FR)', type: 'textarea', rows: 8, hint: 'Texte simple. Séparez les paragraphes par une ligne vide.' }, { key: 'bodyEn', label: 'Content (EN)', type: 'textarea', rows: 8, hint: 'Si vide, la version française est affichée.' },
    ],
  },
  events: {
    name: 'events', title: 'Événements', singular: 'un événement', subtitle: 'Agenda public (à venir / passés calculés selon la date)', workflow: 'content', titleKey: 'titleFr',
    initial: { titleFr: '', titleEn: '', subtitleFr: '', subtitleEn: '', descriptionFr: '', descriptionEn: '', dateLabel: '', startsAt: '', endsAt: '', location: '' },
    cols: [{ label: 'Date', render: (i) => txt(i.dateLabel || fmtDate(i.startsAt)) }, { label: 'Lieu', render: (i) => txt(i.location) }],
    fields: [
      { key: 'titleFr', label: 'Titre (FR)', type: 'text', required: true, max: 200 }, { key: 'titleEn', label: 'Title (EN)', type: 'text', max: 200 },
      { key: 'subtitleFr', label: 'Sous-titre (FR)', type: 'text', max: 300 }, { key: 'subtitleEn', label: 'Subtitle (EN)', type: 'text', max: 300 },
      { key: 'startsAt', label: 'Début', type: 'datetime', required: true, hint: 'Détermine « à venir » ou « passé ».' }, { key: 'endsAt', label: 'Fin (optionnel)', type: 'datetime' },
      { key: 'dateLabel', label: 'Libellé de date affiché', type: 'text', max: 120, hint: 'Ex. « 22–24 octobre 2025 ». Sinon la date de début est utilisée.' }, { key: 'location', label: 'Lieu', type: 'text', max: 200 },
      { key: 'descriptionFr', label: 'Description (FR)', type: 'textarea', rows: 5 }, { key: 'descriptionEn', label: 'Description (EN)', type: 'textarea', rows: 5 },
    ],
  },
  publications: {
    name: 'publications', title: 'Publications', singular: 'une publication', subtitle: 'Rapports, guides et documents', workflow: 'content', titleKey: 'titleFr',
    initial: { category: '', titleFr: '', titleEn: '', summaryFr: '', summaryEn: '', dateLabel: '', fileMediaId: null, externalUrl: '' },
    cols: [{ label: 'Catégorie', render: (i) => txt(i.category) }, { label: 'Date', render: (i) => txt(i.dateLabel) }],
    fields: [
      { key: 'category', label: 'Catégorie', type: 'text', max: 60 }, { key: 'dateLabel', label: 'Date affichée', type: 'text', max: 120, hint: 'Ex. « Décembre 2025 ».' },
      { key: 'titleFr', label: 'Titre (FR)', type: 'text', required: true, max: 200 }, { key: 'titleEn', label: 'Title (EN)', type: 'text', max: 200 },
      { key: 'summaryFr', label: 'Résumé (FR)', type: 'textarea', rows: 4 }, { key: 'summaryEn', label: 'Summary (EN)', type: 'textarea', rows: 4 },
      { key: 'fileMediaId', label: 'Fichier (PDF, DOCX…)', type: 'media', mediaKind: 'any' }, { key: 'externalUrl', label: 'ou lien externe (https://…)', type: 'text', max: 500 },
    ],
  },
  content: {
    name: 'pages', title: 'Contenus', singular: 'une page', subtitle: 'Pages éditables (mentions légales, confidentialité…)', workflow: 'content', titleKey: 'titleFr',
    initial: { slug: '', titleFr: '', titleEn: '', bodyFr: '', bodyEn: '' },
    cols: [{ label: 'Adresse', render: (i) => txt(i.slug) }],
    fields: [
      { key: 'slug', label: 'Identifiant (slug) *', type: 'text', required: true, max: 80, onlyOnCreate: true, hint: 'Ex. « mentions » ou « confidentialite ». Non modifiable ensuite.' }, { key: 'titleFr', label: 'Titre (FR)', type: 'text', required: true, max: 200 },
      { key: 'titleEn', label: 'Title (EN)', type: 'text', max: 200 },
      { key: 'bodyFr', label: 'Contenu (FR)', type: 'textarea', rows: 10, hint: 'Séparez les paragraphes par une ligne vide.' }, { key: 'bodyEn', label: 'Content (EN)', type: 'textarea', rows: 10 },
    ],
  },
  institutions: {
    name: 'institutions', title: 'Institutions', singular: 'une institution', subtitle: 'Sites pilotes, membres et partenaires', workflow: 'institution', titleKey: 'name',
    kindFilter: [['pilot', 'Sites pilotes'], ['member', 'Membres'], ['partner', 'Partenaires']],
    initial: { name: '', kind: 'member', status: 'pending', city: '', descriptionFr: '', descriptionEn: '', websiteUrl: '', sortOrder: 100 },
    cols: [{ label: 'Type', render: (i) => txt({ pilot: 'Site pilote', member: 'Membre', partner: 'Partenaire' }[i.kind as string]) }, { label: 'Ville', render: (i) => txt(i.city) }],
    fields: [
      { key: 'name', label: 'Nom', type: 'text', required: true, max: 200 }, { key: 'city', label: 'Ville', type: 'text', max: 120 },
      { key: 'kind', label: 'Type', type: 'select', options: [['pilot', 'Site pilote'], ['member', 'Membre'], ['partner', 'Partenaire']] },
      { key: 'status', label: 'Statut', type: 'select', options: [['pending', 'En attente'], ['active', 'Actif (visible sur le site)'], ['inactive', 'Inactif']] },
      { key: 'descriptionFr', label: 'Description (FR)', type: 'textarea', rows: 3 }, { key: 'descriptionEn', label: 'Description (EN)', type: 'textarea', rows: 3 },
      { key: 'websiteUrl', label: 'Site web (https://…)', type: 'text', max: 500 }, { key: 'sortOrder', label: 'Ordre d’affichage', type: 'number' },
    ],
  },
}
