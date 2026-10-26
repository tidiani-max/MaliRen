"""
End-to-end smoke test in a real browser (Playwright + Chromium) against a running stack:
  frontend (BASE_URL, default http://localhost:5173)  →  API (/api proxy)  →  PostgreSQL.
Requires a freshly seeded database (npm run db:reset -- --yes && npm run db:seed in backend/).
Usage:  python3 e2e/smoke.py        (see e2e/README.md)
"""

import json
import os
import re
import sys
import tempfile
import time
import urllib.request

from playwright.sync_api import expect, sync_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:5173")
PASSWORD = os.environ.get("DEMO_PASSWORD", "Maliren#Demo2026")
SHOTS = os.environ.get("SHOTS_DIR", tempfile.gettempdir() + "/maliren-shots")
os.makedirs(SHOTS, exist_ok=True)
results = []
page = None


def step(name):
    def deco(fn):
        t = time.time()
        try:
            fn()
            results.append((name, True, ""))
            print(f"  ✔ {name} ({time.time() - t:.1f}s)")
        except Exception as e:  # keep going so one run reports every failure
            try:
                page.screenshot(
                    path=f"{SHOTS}/FAIL-{re.sub(r'[^a-z0-9]+', '-', name.lower())[:40]}.png",
                    full_page=True,
                )
            except Exception:
                pass
            results.append((name, False, str(e).splitlines()[0][:300]))
            print(f"  ✖ {name}: {str(e).splitlines()[0][:300]}")
        return fn

    return deco


PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cfc0f01f0005000201a5f645400000000049454e44ae426082"
)

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1366, "height": 900})
    page = ctx.new_page()
    globals()["page"] = page
    console_errors = []
    page.on(
        "console",
        lambda m: console_errors.append(m.text) if m.type == "error" else None,
    )
    page.on("pageerror", lambda e: console_errors.append("PAGEERROR " + str(e)))
    shot = lambda n: page.screenshot(path=f"{SHOTS}/{n}.png", full_page=True)

    def login(email, pw=PASSWORD):
        page.goto(BASE + "/admin/login")
        page.fill("input[name=email]", email)
        page.fill("input[name=password]", pw)
        page.click("button[type=submit]")

    print("PUBLIC SITE")

    @step("home renders pilot sites from the API")
    def _():
        page.goto(BASE + "/")
        expect(
            page.get_by_role("heading", name="5 sites pilotes connectés")
        ).to_be_visible()
        expect(page.locator(".sites article")).to_have_count(5)
        expect(page.get_by_text("AS328318").first).to_be_visible()
        shot("01-home")

    @step("footer shows contacts and partners from settings/API")
    def _():
        expect(
            page.locator("footer").get_by_text("Cheickné H. DIAWARA")
        ).to_be_visible()
        expect(page.locator("footer .partners span")).to_have_count(4)

    @step("news list comes from the database (3 seeded items) and detail page opens")
    def _():
        page.goto(BASE + "/actualites")
        expect(page.locator("article.panel")).to_have_count(3)
        page.get_by_role("button", name="Consulter").first.click()
        expect(page).to_have_url(re.compile(r"/actualites/[a-z0-9-]+$"))
        expect(page.locator("article.article h1")).to_be_visible()
        expect(page.locator("article.article")).to_contain_text(
            "actualité de démonstration"
        )
        shot("02-news-detail")

    @step("events page splits upcoming/past from dates")
    def _():
        page.goto(BASE + "/evenements")
        expect(page.locator(".event-card")).to_have_count(6)
        page.get_by_role("button", name="Passé").click()
        expect(page.locator(".past-column .event-card").first).to_be_visible()
        expect(
            page.locator(".past-column").get_by_text("PASSÉ  2025").first
        ).to_be_visible()
        shot("03-events")

    @step("publications and institutions listings")
    def _():
        page.goto(BASE + "/publications")
        expect(page.locator("article.panel")).to_have_count(2)
        page.goto(BASE + "/institutions")
        expect(page.locator("article.panel")).to_have_count(9)

    @step("search finds database content")
    def _():
        page.goto(BASE + "/recherche")
        page.fill(".search-page input", "afribone")
        expect(page.locator(".search-result").first).to_be_visible()

    @step("legal page served from the pages table")
    def _():
        page.goto(BASE + "/confidentialite")
        expect(page.locator("article.article")).to_contain_text(
            "enregistrés sur les serveurs"
        )
        expect(page.locator("article.article")).not_to_contain_text(
            "uniquement les données dans votre navigateur"
        )

    @step("language switch FR→EN translates static UI and data fields")
    def _():
        page.goto(BASE + "/actualites")
        page.get_by_role("button", name="EN", exact=True).first.click()
        expect(page.locator("nav").get_by_text("Home")).to_be_visible()
        expect(page.get_by_text("The Point G NOC is now operational")).to_be_visible()
        page.get_by_role("button", name="FR", exact=True).first.click()

    CONTACT_MSG = f"Message E2E {int(time.time())}  demande de connexion eduroam."

    @step("contact form: validation error shown, then real submission succeeds")
    def _():
        page.goto(BASE + "/contact")
        page.get_by_role("button", name=re.compile("Envoyer")).click()
        expect(page.locator(".form .error")).to_be_visible()
        page.fill("input[name=name]", "Awa Traoré")
        page.fill("input[name=email]", "awa.e2e@example.org")
        page.fill("input[name=subject]", "Connexion eduroam")
        page.fill("textarea[name=message]", CONTACT_MSG)
        page.check("input[name=consent]")
        page.get_by_role("button", name=re.compile("Envoyer")).click()
        expect(page.locator(".form .success")).to_be_visible()
        shot("04-contact-sent")

    print("ADMIN")

    @step("wrong password is rejected with a clear message")
    def _():
        login("admin@maliren.ml", "not-the-password-1")
        expect(page.locator(".login-form .error")).to_contain_text("incorrect")

    @step("super admin signs in and sees live dashboard metrics")
    def _():
        login("admin@maliren.ml")
        expect(page).to_have_url(re.compile("/admin/dashboard"))
        expect(page.locator(".metrics article").first).to_be_visible()
        expect(page.locator(".metrics")).to_contain_text("Nouvelles demandes")
        shot("05-dashboard")

    @step("session survives a full page reload (httpOnly refresh cookie)")
    def _():
        page.reload()
        expect(page.locator(".admin-user")).to_contain_text("Super administrateur")
        assert "maliren_rt" not in page.evaluate("document.cookie"), (
            "refresh cookie must not be readable from JS"
        )
        assert not page.evaluate("JSON.stringify(localStorage)").count("eyJ"), (
            "no JWT in localStorage"
        )

    @step("contact message appears in Demandes and in notifications (worker ran)")
    def _():
        page.wait_for_timeout(7000)  # worker poll interval
        page.get_by_role("button", name=re.compile("^Demandes")).click()
        expect(page.locator("table")).to_contain_text("Connexion eduroam")
        page.locator(".bell .icon-btn").click()
        expect(page.locator(".bell-pop")).to_contain_text("Nouvelle demande")
        page.keyboard.press("Escape")
        page.mouse.click(5, 5)

    @step("triage: assign + status + internal note persist after reload")
    def _():
        page.locator("tr.clickable", has_text="Connexion eduroam").first.click()
        modal = page.locator(".modal")
        expect(modal).to_contain_text(CONTACT_MSG)
        modal.locator("select").first.select_option("in_progress")
        page.wait_for_timeout(600)
        modal.locator("textarea").fill("Appelé le demandeur, rappel prévu.")
        modal.get_by_role("button", name="Ajouter").click()
        expect(modal.locator(".note")).to_contain_text("Appelé le demandeur")
        shot("06-submission-modal")
        page.keyboard.press("Escape")
        page.reload()
        page.locator("tr.clickable", has_text="Connexion eduroam").first.click()
        expect(page.locator(".modal .note")).to_contain_text("rappel prévu")
        expect(page.locator(".modal select").first).to_have_value("in_progress")
        page.keyboard.press("Escape")

    NEWS_TITLE = f"Actualité E2E {int(time.time())}"

    @step("create a news draft, publish it, and it appears on the public site")
    def _():
        page.get_by_role("button", name=re.compile("^Actualités")).click()
        page.get_by_role("button", name=re.compile("Créer une actualité")).click()
        page.fill("#titleFr", NEWS_TITLE)
        page.fill("#titleEn", "E2E news")
        page.fill("#category", "Test")
        page.fill("#excerptFr", "Résumé E2E")
        page.fill("#bodyFr", "Premier paragraphe.\n\nSecond paragraphe.")
        page.get_by_role("button", name="Enregistrer").click()
        row = page.locator("tr", has_text=NEWS_TITLE)
        expect(row).to_be_visible()
        expect(row).to_contain_text("Brouillon")
        pub = ctx.new_page()
        pub.goto(BASE + "/actualites")
        expect(pub.get_by_text(NEWS_TITLE)).to_have_count(0)  # drafts are invisible
        row.locator("select").select_option(label="Publier")
        expect(row).to_contain_text("Publié")
        pub.goto(BASE + "/actualites")
        expect(pub.get_by_text(NEWS_TITLE)).to_be_visible()
        pub.get_by_text(NEWS_TITLE).locator("xpath=ancestor::article").get_by_role(
            "button", name="Consulter"
        ).click()
        expect(pub.locator("article.article")).to_contain_text("Second paragraphe.")
        pub.close()
        shot("07-news-admin")

    @step("edit then unpublish and delete the news item")
    def _():
        row = page.locator("tr", has_text=NEWS_TITLE)
        row.get_by_role("button", name="Modifier").click()
        page.fill("#titleEn", "E2E news (edited)")
        page.get_by_role("button", name="Enregistrer").click()
        expect(page.locator(".toast").first).to_be_visible()
        row = page.locator("tr", has_text=NEWS_TITLE)
        row.locator("select").select_option(label="Dépublier")
        expect(row).to_contain_text("Brouillon")
        row.locator("select").select_option(label="Supprimer…")
        page.locator(".modal").get_by_role("button", name="Supprimer").click()
        expect(page.locator("tr", has_text=NEWS_TITLE)).to_have_count(0)

    @step(
        "event and institution can be created (validation errors surface in the form)"
    )
    def _():
        page.get_by_role("button", name=re.compile("^Événements")).click()
        page.get_by_role("button", name=re.compile("Créer un événement")).click()
        page.fill("#titleFr", "Atelier E2E")
        page.get_by_role("button", name="Enregistrer").click()  # startsAt missing
        expect(page.locator("#startsAt:invalid")).to_have_count(
            1
        )  # native required-field validation blocks the submit
        expect(page.locator(".modal")).to_be_visible()
        page.fill("#startsAt", "2031-05-01T09:00")
        page.get_by_role("button", name="Enregistrer").click()
        expect(page.locator("tr", has_text="Atelier E2E")).to_be_visible()
        page.get_by_role("button", name=re.compile("^Institutions")).click()
        page.get_by_role("button", name=re.compile("Créer une institution")).click()
        page.fill("#name", "Université E2E")
        page.get_by_role("button", name="Enregistrer").click()
        expect(page.locator("tr", has_text="Université E2E")).to_contain_text(
            "En attente"
        )

    @step("media: upload an image, edit alt text, then delete it")
    def _():
        page.get_by_role("button", name=re.compile("^Médiathèque")).click()
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            f.write(PNG)
            path = f.name
        page.set_input_files("input[type=file]", path)
        expect(page.locator(".media-card")).to_have_count(1)
        expect(page.locator(".media-card img")).to_be_visible()
        page.get_by_role("button", name="Modifier").click()
        page.locator(".modal input").first.fill("Logo test")
        page.get_by_role("button", name="Enregistrer").click()
        shot("08-media")
        page.get_by_role("button", name="Supprimer").click()
        page.locator(".modal").get_by_role("button", name="Supprimer").click()
        expect(page.locator(".media-card")).to_have_count(0)

    @step(
        "users: invite shows one-time password; reports, activity, settings pages load"
    )
    def _():
        page.get_by_role("button", name=re.compile("^Utilisateurs")).click()
        page.get_by_role("button", name="Inviter un utilisateur").click()
        page.locator(".modal input").nth(0).fill("Nouvel Éditeur")
        page.locator(".modal input").nth(1).fill(f"e2e{int(time.time())}@maliren.ml")
        page.get_by_role("button", name="Créer le compte").click()
        expect(page.locator(".secret code")).to_be_visible()
        page.get_by_role("button", name="J’ai noté le mot de passe").click()
        page.get_by_role("button", name=re.compile("^Rapports")).click()
        expect(page.locator(".metrics")).to_contain_text("Demandes reçues")
        shot("09-reports")
        page.get_by_role("button", name=re.compile("^Activité")).click()
        expect(page.locator("table")).to_contain_text("login.success")
        page.get_by_role("button", name="Tâches automatiques").click()
        expect(page.locator("table")).to_contain_text("notify_new_submission")
        page.get_by_role("button", name="E-mails").click()
        expect(page.locator("table")).to_contain_text("Nouvelle demande")
        shot("10-activity-emails")
        page.get_by_role("button", name=re.compile("^Paramètres")).click()
        expect(page.locator(".form-grid input").first).to_have_value(
            "Cheickné H. DIAWARA"
        )

    @step("settings: automation dry-run previews without side effects")
    def _():
        page.get_by_role("button", name="Automatisations").click()
        card = page.locator(
            "article.admin-panel", has_text="Rappel des demandes non traitées"
        )
        card.get_by_role("button", name="Simuler (dry-run)").click()
        expect(card.locator(".result-box")).to_contain_text("aucun e-mail envoyé")
        shot("11-automation")

    @step("logout ends the session; admin URL redirects to login")
    def _():
        page.get_by_role("button", name="Se déconnecter").click()
        expect(page).to_have_url(re.compile("/admin/login"))
        page.goto(BASE + "/admin/dashboard")
        expect(page).to_have_url(re.compile("/admin/login"))

    print("ROLES")

    @step("reviewer is read-only: no create buttons, no users/settings in nav")
    def _():
        login("reviewer@maliren.ml")
        expect(page).to_have_url(re.compile("/admin/dashboard"))
        expect(
            page.get_by_role("button", name=re.compile("^Utilisateurs"))
        ).to_have_count(0)
        expect(
            page.get_by_role("button", name=re.compile("^Paramètres"))
        ).to_have_count(0)
        page.get_by_role("button", name=re.compile("^Actualités")).click()
        expect(page.locator("tr").nth(1)).to_be_visible()
        expect(page.get_by_role("button", name=re.compile("Créer"))).to_have_count(0)
        expect(page.get_by_text("Lecture seule").first).to_be_visible()
        page.get_by_role("button", name="Se déconnecter").click()

    @step("editor can create content but cannot see Utilisateurs")
    def _():
        login("editor@maliren.ml")
        expect(page).to_have_url(re.compile("/admin/dashboard"))
        expect(
            page.get_by_role("button", name=re.compile("^Utilisateurs"))
        ).to_have_count(0)
        page.get_by_role("button", name=re.compile("^Actualités")).click()
        expect(
            page.get_by_role("button", name=re.compile("Créer une actualité"))
        ).to_be_visible()
        page.get_by_role("button", name="Se déconnecter").click()

    print("RESPONSIVE")

    @step("mobile layout: public home and admin menu")
    def _():
        page.set_viewport_size({"width": 390, "height": 800})
        page.goto(BASE + "/")
        shot("12-mobile-home")
        login("admin@maliren.ml")
        page.locator(".admin-menu").click()
        expect(page.locator(".admin aside.open")).to_be_visible()
        shot("13-mobile-admin")

    browser.close()

bad_console = [
    e
    for e in console_errors
    if "favicon" not in e and "Failed to load resource" not in e
]
print(f"\nconsole errors: {len(bad_console)}")
[print("  -", e[:200]) for e in bad_console[:8]]
failed = [r for r in results if not r[1]]
print(
    f"\n{len(results) - len(failed)}/{len(results)} steps passed; screenshots in {SHOTS}"
)
sys.exit(1 if failed or bad_console else 0)
