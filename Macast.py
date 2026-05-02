# Copyright (c) 2021 by xfangfang. All Rights Reserved.

import os
import sys
import gettext
import logging
from macast import Setting, SETTING_DIR
from macast.macast import gui

logger = logging.getLogger("Macast")
logger.setLevel(logging.DEBUG)


def get_base_path(path="."):
    if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
        base_path = sys._MEIPASS
    else:
        base_path = os.getcwd()
    return os.path.join(base_path, path)


def set_mpv_default_path():
    mpv_path = 'mpv'
    if sys.platform == 'darwin':
        mpv_path = get_base_path('bin/MacOS/mpv')
    elif sys.platform == 'win32':
        mpv_path = get_base_path('bin/mpv.exe')
    Setting.mpv_default_path = mpv_path
    return mpv_path


def get_lang():
    locale = Setting.get_locale()
    i18n_path = get_base_path('i18n')
    if not os.path.exists(os.path.join(i18n_path, locale, 'LC_MESSAGES', 'macast.mo')):
        locale = locale.split("_")[0]
    logger.error("Macast Loading Language: {}".format(locale))
    try:
        lang = gettext.translation('macast', localedir=i18n_path, languages=[locale])
        lang.install()
    except Exception:
        import builtins
        builtins.__dict__['_'] = gettext.gettext
        logger.error("Macast Loading Default Language en_US")


def setup_logging():
    log_path = os.path.join(SETTING_DIR, 'macast_debug.log')
    # Ensure the directory exists
    os.makedirs(SETTING_DIR, exist_ok=True)
    # Remove old debug log on startup
    try:
        os.remove(log_path)
    except:
        pass
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.DEBUG)
    handler = logging.FileHandler(log_path, encoding='utf-8')
    handler.setFormatter(logging.Formatter(
        '[%(asctime)s] %(name)s %(levelname)s: %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'))
    for h in root_logger.handlers[:]:
        root_logger.removeHandler(h)
    root_logger.addHandler(handler)


def clear_env():
    # todo clear pyinstaller file on start
    log_path = os.path.join(SETTING_DIR, 'macast.log')
    try:
        os.remove(log_path)
    except:
        pass


if __name__ == '__main__':
    clear_env()
    setup_logging()
    get_lang()
    set_mpv_default_path()
    gui(lang=_)
