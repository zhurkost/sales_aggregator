# Размещение на VPS

Адрес: https://87.199.205.227. Запчасти: https://87.199.205.227/?category=parts. Ubuntu 24.04 LTS, x86_64. Сайт закрыт отдельной учётной записью `autopost` через HTTP Basic Auth только по HTTPS. Пароль не совпадает с паролем root и не хранится в GitHub. Он передан владельцу локальным файлом «Автопост — доступ к сайту.txt» вне репозитория.

## Устройство

- nginx раздаёт `dist-vps/client`, проверяет пароль и передаёт только `/api/` в Node.js.
- Node.js 22.18+ запускает `vps/server.mjs` на `127.0.0.1:3000` от системного пользователя `autopost`. Npm-пакеты на сервере не нужны: API использует встроенные возможности Node и исходные TypeScript-модули.
- Страница и обработчики ИИ общие с версией Sites; отдельный `vite.vps.config.ts` только собирает клиент.
- Прокси заменяет заголовок `X-Autopost-Proxy-Secret` своим секретом. API проверяет его и игнорирует клиентские заголовки идентификации. Порт 3000 наружу не открыт.
- Ограничение памяти API — 300 МБ. Приложение перезапускается при сбое и запускается после перезагрузки.
- UFW разрешает SSH (22) и веб (80/443). SSH-доступ владельца сохранён.
- Фотографии, черновики и история хранятся в браузере. Сервер не является их резервной копией.

## Файлы на сервере

| Путь | Назначение |
|---|---|
| `/opt/autopost/current` | Ссылка на активную версию |
| `/opt/autopost/releases/` | Версии для отката |
| `/opt/node/bin/node` | Node.js 22 |
| `/etc/autopost/environment` | Ключ ИИ, модель, `PUBLIC_ORIGIN`, `VPS_PROXY_SECRET`; root, 600 |
| `/etc/autopost/htpasswd` | Хеш пароля сайта; root:www-data, 640 |
| `/etc/autopost/proxy-headers.conf` | Секрет между nginx и API; root, 600 |
| `/etc/nginx/sites-available/autopost` | HTTPS и маршрутизация |
| `/etc/systemd/system/autopost.service` | Запуск API |
| `/etc/letsencrypt/` | Сертификат и настройки продления |

Не добавляйте секреты в репозиторий, архив релиза, клиентскую сборку или командную строку.

## Обновление

На рабочем компьютере или в CI:

```sh
npm ci
npm test
npm run typecheck
npm run package:vps
```

Архив `work/autopost-vps.tar.gz` содержит только клиент и необходимые исходники API. Передать его по SFTP в `/root/autopost-deploy/release.tar.gz` и актуальный `vps/deploy-release.sh` в тот же каталог. Затем на сервере:

```sh
bash /root/autopost-deploy/deploy-release.sh /root/autopost-deploy/release.tar.gz
```

Скрипт создаёт новую версию, переключает `current`, перезапускает API, проверяет `/healthz` и перезагружает nginx. При ошибке запуска API возвращает предыдущую версию, если она есть. Секреты не меняет. Для ручного отката выбрать ранее проверенный каталог в `releases`, переключить `current` и перезапустить `autopost`.

## HTTPS

Используется доверенный сертификат Let's Encrypt непосредственно на IP-адрес. Такие сертификаты краткосрочные; таймер `autopost-cert-renew.timer` проверяет продление каждые 6 часов, с небольшим случайным сдвигом. Порт 80 нужен для HTTP-01 challenge; остальные HTTP-запросы перенаправляются на HTTPS. Deploy hook перезагружает nginx после продления.

Certbot установлен в `/opt/certbot`, версия 5.4+ с поддержкой IP и webroot. [Официальная документация Let's Encrypt](https://letsencrypt.org/2026/03/11/shorter-certs-certbot).

```sh
systemctl status autopost nginx autopost-cert-renew.timer
systemctl list-timers autopost-cert-renew.timer
/opt/certbot/bin/certbot renew --dry-run --no-random-sleep-on-renew --run-deploy-hooks
journalctl -u autopost -n 50 --no-pager
```

Чтобы сменить пароль сайта, выполнить `htpasswd /etc/autopost/htpasswd autopost` — новый пароль будет запрошен интерактивно. Для смены API-ключа отредактировать `/etc/autopost/environment` и перезапустить `autopost`.

## Перенос на домен

После привязки DNS потребуется выпустить сертификат для домена, изменить `server_name` и HTTP-перенаправление nginx, `PUBLIC_ORIGIN` в окружении API, добавить точный HTTPS-origin в `extension/manifest.json` и `extension/core.js`, пересобрать и обновить расширение. Черновики привязаны к origin браузера: перед сменой адреса их нужно экспортировать; фото сохранить отдельно.

Закрытый MVP ещё не является многопользовательским сервисом. Для публичного запуска нужны индивидуальные аккаунты, постоянные квоты ИИ и проверка адаптеров на реальных формах площадок.
