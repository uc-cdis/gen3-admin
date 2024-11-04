# How to generate the Go code from the proto file


https://grpc.io/docs/languages/go/quickstart/


Go plugins for the protocol compiler:

Install the protocol compiler plugins for Go using the following commands:
```bash
go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest
```

Update your PATH so that the protoc compiler can find the plugins:

```bash
export PATH="$PATH:$(go env GOPATH)/bin"
```

Then you need to recompile the .proto file.

```golang
protoc --go_out=. --go_opt=paths=source_relative \
       --go-grpc_out=. --go-grpc_opt=paths=source_relative \
       tunnel.proto
```
