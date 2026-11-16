"""Point d'entrée du bot Discord de gestion."""
import argparse
import logging
import os
from pathlib import Path

import discord
from dotenv import load_dotenv

from management_bot import ManagementBot

ROOT = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description="Bot Discord de gestion.")
    parser.add_argument("--check", action="store_true", help="Vérifier les commandes sans connexion.")
    args = parser.parse_args()
    load_dotenv(ROOT / ".env")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    data_dir = Path(os.getenv("DATA_DIR", str(ROOT / "data")))
    bot = ManagementBot(data_dir)

    if args.check:
        commands = sorted({command.name for command in bot.commands})
        print(f"Validation réussie : {len(commands)} commandes, préfixe +.")
        return

    token = os.getenv("DISCORD_TOKEN") or os.getenv("TOKEN")
    if not token:
        raise SystemExit("Configure DISCORD_TOKEN dans les variables privées de Fade Host.")
    try:
        bot.run(token, log_handler=None)
    except discord.LoginFailure:
        raise SystemExit("Connexion Discord refusée : vérifie le jeton privé sur Fade Host.") from None


if __name__ == "__main__":
    main()
