// PB3 #388: real Matrix JS SDK Megolm E2EE across TWO disposable Synapse homeservers.
// Inject into pinned matrix-org/complement-crypto/tests at CI runtime.
// This verifies a generic SDK cryptographic transport boundary, NOT PB3 integration,
// recovery-key envelopes, native devices, privacy guarantees or product release.
package tests

import (
    "net/http"
    "strings"
    "testing"
    "time"

    "github.com/matrix-org/complement-crypto/internal/api"
    "github.com/matrix-org/complement-crypto/internal/cc"
    "github.com/matrix-org/complement/client"
    "github.com/matrix-org/gomatrixserverlib/spec"
    "github.com/tidwall/gjson"
)

func pb3VerifyWireEncrypted(t *testing.T, u *client.CSAPI, roomID, eventID, syntheticCanary string) {
    t.Helper()
    res := u.MustDo(t, "GET", []string{
        "_matrix", "client", "v3", "rooms", roomID, "event", eventID,
    })
    raw := client.ParseJSON(t, res)
    event := gjson.ParseBytes(raw)
    if event.Get("event_id").Str != eventID ||
        event.Get("room_id").Str != roomID ||
        event.Get("type").Str != "m.room.encrypted" ||
        event.Get("content.algorithm").Str != "m.megolm.v1.aes-sha2" {
        t.Fatal("actual server did not retain the encrypted Matrix event envelope")
    }
    if len(event.Get("content.ciphertext").Str) < 16 ||
        event.Get("content.session_id").Str == "" ||
        event.Get("content.sender_key").Str == "" {
        t.Fatal("actual SDK event missing encrypted Megolm ciphertext or session metadata")
    }
    if strings.Contains(string(raw), syntheticCanary) {
        t.Fatal("unencrypted synthetic canary visible to homeserver")
    }
}

// TestPB3RealFederatedJSDecryptRoundTrip verifies actual SDK encrypt AND decrypt.
// A plain m.room.encrypted-looking fixture is NOT accepted: the recipient JS SDK
// must decrypt the exact canary text and the raw server event must remain opaque.
func TestPB3RealFederatedJSDecryptRoundTrip(t *testing.T) {
    Instance().ForEachClientType(t, func(t *testing.T, clientType api.ClientType) {
        tc := Instance().CreateTestContext(t,
            api.ClientType{Lang: clientType.Lang, HS: "hs1"},
            api.ClientType{Lang: clientType.Lang, HS: "hs2"},
            api.ClientType{Lang: clientType.Lang, HS: "hs2"},
        )
        if tc.Alice.UserID == tc.Bob.UserID ||
            tc.Alice.UserID == tc.Charlie.UserID ||
            tc.Bob.UserID == tc.Charlie.UserID ||
            tc.Alice.BaseURL == tc.Bob.BaseURL {
            t.Fatal("independent homeservers or three independent users not provisioned")
        }

        roomID := tc.CreateNewEncryptedRoom(t, tc.Alice,
            cc.EncRoomOptions.Invite([]string{tc.Bob.UserID}))
        tc.Bob.MustJoinRoom(t, roomID, []spec.ServerName{"hs1"})
        tc.WithAliceAndBobSyncing(t, func(alice, bob api.TestClient) {
            // Wait briefly for SDK device-list synchronisation; this is not
            // a retry/skip of failed cryptographic tests.
            time.Sleep(time.Second)

            const aliceCanary = "PB3_DISPOSABLE_SDK_CRYPTO_ALICE_TO_BOB_388"
            waiterB := bob.WaitUntilEventInRoom(
                t, roomID, api.CheckEventHasBody(aliceCanary))
            aliceEventID := alice.MustSendMessage(t, roomID, aliceCanary)
            waiterB.Waitf(t, 12*time.Second, "Bob SDK failed to decrypt Alice's federated Megolm event")
            // Both independent servers must expose encrypted bytes, never
            // the decrypted application canary, even to authorised accounts.
            pb3VerifyWireEncrypted(t, tc.Alice.CSAPI, roomID, aliceEventID, aliceCanary)
            pb3VerifyWireEncrypted(t, tc.Bob.CSAPI, roomID, aliceEventID, aliceCanary)

            const bobCanary = "PB3_DISPOSABLE_SDK_CRYPTO_BOB_TO_ALICE_388"
            waiterA := alice.WaitUntilEventInRoom(
                t, roomID, api.CheckEventHasBody(bobCanary))
            bobEventID := bob.MustSendMessage(t, roomID, bobCanary)
            waiterA.Waitf(t, 12*time.Second, "Alice SDK failed to decrypt Bob's federated Megolm reply")
            pb3VerifyWireEncrypted(t, tc.Alice.CSAPI, roomID, bobEventID, bobCanary)
            pb3VerifyWireEncrypted(t, tc.Bob.CSAPI, roomID, bobEventID, bobCanary)

            // Charlie is a genuinely authenticated user at Bob's homeserver
            // but is not a room member. A 401 would only prove a bad token.
            outsiderEvent := tc.Charlie.Do(t, "GET", []string{
                "_matrix", "client", "v3", "rooms", roomID,
                "event", aliceEventID,
            })
            defer outsiderEvent.Body.Close()
            if outsiderEvent.StatusCode != http.StatusForbidden &&
                outsiderEvent.StatusCode != http.StatusNotFound {
                t.Fatalf("authenticated outsider was able to inspect E2EE event, HTTP %d", outsiderEvent.StatusCode)
            }
        })
    })
}
