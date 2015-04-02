# [Lockee](https://www.lockee.me/)

## Temporary encrypted file lockers on the web.
Seen those luggage lockers at the railway station? It’s like that, but for files.

![Lockee Screenshot](https://raw.githubusercontent.com/hbons/Lockee/master/public/images/screenshots/screenshot-2.png)

### Simple
Tag your locker, select a file from your device, and enter a passphrase.
To retrieve a stored file, go to `lockee.me/your_tag` and enter your passphrase.

### Private
Lockers are anonymous and passphrase protected. No personal information is required or collected.
Files put in lockers are encrypted on your device before being sent securely to the server.

### Open Source
Lockee is Free and Open Source software. You can see the source code and even run your own instance.
Questions or comments? Contact [Hylke Bons](https://github.com/hbons).

## Install and run

```shell
git clone https://github.com/hbons/Lockee
cd Lockee/
npm install
npm start
```

By default, Lockee is accessible on `http:://localhost:3000/`. You can change this, as well as other configuration options, in `config.json`.

## License
You can use, modify, and redistribute Lockee under the terms of the [AGPLv3](), given that you change the software’s visible name and logo.
