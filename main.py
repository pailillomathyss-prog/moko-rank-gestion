"""Point d’entrée : python main.py (TOKEN requis) ou python main.py --check."""
import argparse
import logging
import os
from pathlib import Path

import discord
from dotenv import load_dotenv

from quiz.discord_bot import QuizClient
from quiz.questions import QuestionBank

ROOT = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description="Bot Discord de devinettes.")
    parser.add_argument("--check", action="store_true", help="Valider les images et les commandes sans connexion Discord.")
    args = parser.parse_args()
    load_dotenv(ROOT / ".env")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    if args.check:
        bank = QuestionBank()
        for question in bank.questions:
            question.image()
        client = QuizClient(":memory:")
        commands = client.tree.get_commands()
        for command in commands:
            command.to_dict(client.tree)
        print(f"Validation réussie : {len(bank.questions)} images locales, calculs générés, commandes "
              + ", ".join("/" + command.name for command in commands))
        return
    token = os.getenv("TOKEN") or os.getenv("DISCORD_BOT_TOKEN")
    if not token:
        raise SystemExit("Ajoute TOKEN dans Replit Secrets (ou DISCORD_BOT_TOKEN), puis relance. Ne partage jamais sa valeur.")
    data_dir = Path(os.getenv("DATA_DIR", str(ROOT / "data")))
    client = QuizClient(str(data_dir / "quiz.sqlite"))
    try:
        client.run(token, log_handler=None)
    except discord.LoginFailure:
        raise SystemExit("Connexion refusée : vérifie le token dans les secrets.") from None
    except discord.PrivilegedIntentsRequired:
        raise SystemExit("Active MESSAGE CONTENT INTENT dans Discord Developer Portal > Bot.") from None


if __name__ == "__main__":
    main()
