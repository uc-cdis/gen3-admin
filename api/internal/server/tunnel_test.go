package server

import (
	"net"
	"sync"
	"testing"

	pb "github.com/uc-cdis/gen3-admin/internal/tunnel"
	"google.golang.org/grpc"
)

// stubStream satisfies the send path without a real gRPC connection.
type stubStream struct{ grpc.ServerStream }

func (s *stubStream) Send(*pb.ServerMessage) error    { return nil }
func (s *stubStream) Recv() (*pb.AgentMessage, error) { return nil, nil }

// Exercise concurrent closeTunnel + ack delivery, the teardown race.
func TestTunnelCloseRace(t *testing.T) {
	for i := 0; i < 200; i++ {
		a := &AgentConnection{
			tunnelConns:  make(map[string]net.Conn),
			tunnelOpened: make(map[string]chan *pb.TunnelOpened),
			stream:       &stubStream{},
		}
		c1, c2 := net.Pipe()
		id := "s1"
		ack := make(chan *pb.TunnelOpened, 1)
		a.mutex.Lock()
		a.tunnelConns[id] = c1
		a.tunnelOpened[id] = ack
		a.mutex.Unlock()

		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			a.mutex.Lock()
			ch, ok := a.tunnelOpened[id]
			a.mutex.Unlock()
			if ok {
				select {
				case ch <- &pb.TunnelOpened{StreamId: id}:
				default:
				}
			}
		}()
		go func() {
			defer wg.Done()
			defer func() {
				if r := recover(); r != nil {
					t.Errorf("panic during close: %v", r)
				}
			}()
			a.closeTunnel(id)
		}()
		wg.Wait()
		c2.Close()
	}
}
