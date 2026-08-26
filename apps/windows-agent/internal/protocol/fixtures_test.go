package protocol

import (
	"encoding/base64"
	"encoding/json"
	"os/exec"
	"testing"
)

const contractCommit = "910b69e24f464bb3e89152f3e5881beb9b706b76"

type fixtureFile struct {
	Transcripts []fixtureTranscript `json:"transcripts"`
}

type fixtureTranscript struct {
	ID      string `json:"id"`
	Initial struct {
		ConnectionState ConnectionState `json:"connectionState"`
		SessionState    SessionState    `json:"sessionState"`
		NextSequence    struct {
			Client uint64 `json:"client_to_agent"`
			Agent  uint64 `json:"agent_to_client"`
		} `json:"nextSequence"`
	} `json:"initial"`
	Frames []struct {
		Direction Direction      `json:"direction"`
		Raw       string         `json:"raw"`
		Frame     map[string]any `json:"frame"`
		Generate  struct {
			DecodedBytes       int `json:"decodedBytes"`
			WireTrailingSpaces int `json:"wireTrailingSpaces"`
		} `json:"generate"`
	} `json:"frames"`
	Expected struct {
		ConnectionState ConnectionState `json:"connectionState"`
		SessionState    SessionState    `json:"sessionState"`
		Code            ErrorCode       `json:"code"`
		AtFrame         int             `json:"atFrame"`
	} `json:"expected"`
}

func TestCanonicalAcceptedTranscripts(t *testing.T) {
	fixtures := loadFixtures(t, "packages/protocol/fixtures/accepted.json")
	for _, transcript := range fixtures.Transcripts {
		t.Run(transcript.ID, func(t *testing.T) {
			machine := NewMachine(transcript.Initial.ConnectionState, transcript.Initial.SessionState, transcript.Initial.NextSequence.Client, transcript.Initial.NextSequence.Agent)
			for index, item := range transcript.Frames {
				data := fixtureBytes(t, item.Raw, item.Frame, item.Generate.DecodedBytes, item.Generate.WireTrailingSpaces)
				decoded, err := Decode(data)
				if err != nil {
					t.Fatalf("frame %d decode: %v", index, err)
				}
				if err := machine.Apply(item.Direction, decoded); err != nil {
					t.Fatalf("frame %d state: %v", index, err)
				}
			}
			if machine.Connection != transcript.Expected.ConnectionState || machine.Session != transcript.Expected.SessionState {
				t.Fatalf("state = %s/%s, want %s/%s", machine.Connection, machine.Session, transcript.Expected.ConnectionState, transcript.Expected.SessionState)
			}
		})
	}
}

func TestCanonicalRejectedSyntaxAndState(t *testing.T) {
	semantic := map[string]bool{"unsupported-negotiated-version": true, "expired-authentication-challenge": true, "wrong-authentication-proof": true, "replayed-resume-grant": true}
	fixtures := loadFixtures(t, "packages/protocol/fixtures/rejected.json")
	for _, transcript := range fixtures.Transcripts {
		if semantic[transcript.ID] {
			continue
		}
		t.Run(transcript.ID, func(t *testing.T) {
			machine := NewMachine(transcript.Initial.ConnectionState, transcript.Initial.SessionState, transcript.Initial.NextSequence.Client, transcript.Initial.NextSequence.Agent)
			var got error
			for _, item := range transcript.Frames {
				data := fixtureBytes(t, item.Raw, item.Frame, item.Generate.DecodedBytes, item.Generate.WireTrailingSpaces)
				decoded, err := Decode(data)
				if err == nil {
					err = machine.Apply(item.Direction, decoded)
				}
				if err != nil {
					got = err
					break
				}
			}
			code, _, ok := ErrorDetails(got)
			if !ok || code != transcript.Expected.Code {
				t.Fatalf("error = %v (%s), want %s", got, code, transcript.Expected.Code)
			}
		})
	}
}

func loadFixtures(t *testing.T, path string) fixtureFile {
	t.Helper()
	command := exec.Command("git", "show", contractCommit+":"+path)
	data, err := command.Output()
	if err != nil {
		t.Fatalf("read exact contract fixture: %v", err)
	}
	var result fixtureFile
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatal(err)
	}
	return result
}

func fixtureBytes(t *testing.T, raw string, frame map[string]any, decodedBytes, trailing int) []byte {
	t.Helper()
	if raw != "" {
		return []byte(raw)
	}
	if decodedBytes > 0 {
		payload := frame["payload"].(map[string]any)
		payload["data"] = base64.RawURLEncoding.EncodeToString(make([]byte, decodedBytes))
	}
	data, err := json.Marshal(frame)
	if err != nil {
		t.Fatal(err)
	}
	if trailing > 0 {
		data = append(data, make([]byte, trailing)...)
		for index := len(data) - trailing; index < len(data); index++ {
			data[index] = ' '
		}
	}
	return data
}
