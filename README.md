# hyper-nameserver

Nameserver with Hyperbee (experiment)

```
npm i -g hyper-nameserver
```

## Usage

Both the registry and server, will use folders in `~/.hyper-nameserver` as storage.

Add a new domain entry to the registry:

```sh
hyper-nameserver-registry --name <domain.tld> --type A --value [IP address] [--storage <path>]
# It prints a key. Keep this running for a moment so the later server syncs up
```

Note: Add `--ns <ns1.nameserver.tld> --ns <ns2...>` to check if the domain points to your ns1.* and ns2.*

In a new terminal, run a server:

```sh
hyper-nameserver <registry-core-key> [--port 53] [--storage <path>]
```

Note: You can set a port like `--port 1053` to avoid root permission.

Test that it works:

```sh
dig @127.0.0.1 -p 1053 <domain.tld>
```

Later you can stop the registry and just keep the server.

## License

MIT
