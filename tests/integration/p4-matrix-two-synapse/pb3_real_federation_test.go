// Real disposable two-Synapse federation transport smoke for PB3 #381 / parent #238.
// Compiled INSIDE the pinned matrix-org/complement 'tests' package in CI.
// There is no SDK-side encryption here: Megolm envelope fields are inert fixtures.
// This proves interserver Matrix API transport and ACL, NEVER E2EE decryption.
package tests

import (
    "net/http"
    "testing"

    "github.com/matrix-org/complement"
    "github.com/matrix-org/complement/b"
    "github.com/matrix-org/complement/client"
    "github.com/matrix-org/complement/helpers"
    "github.com/matrix-org/gomatrixserverlib/spec"
)

func pb3AssertEvent(t *testing.T, u *client.CSAPI, roomID, eventID, sender string) {
    t.Helper()
    res := u.MustDo(t, "GET", []string{
        "_matrix", "client", "v3", "rooms", roomID, "event", eventID,
    })
    event := client.ParseJSON(t, res)
    if event.Get("event_id").Str != eventID ||
        event.Get("room_id").Str != roomID ||
        event.Get("sender").Str != sender ||
        event.Get("type").Str != "m.room.encrypted" ||
        event.Get("content.algorithm").Str != "m.megolm.v1.aes-sha2" ||
        event.Get("content.ciphertext").Str != "pb3_disposable_noncryptographic_envelope" ||
        event.Get("content.session_id").Str != "disposable_session" ||
        event.Get("content.sender_key").Str != "disposable_sender_key" {
        t.Fatal("encrypted-event metadata differed between actual homeservers")
    }
}

func pb3AssertMembership(t *testing.T, u *client.CSAPI, roomID, alice, bob, outsider string) {
    t.Helper()
    res := u.MustDo(t, "GET", []string{
        "_matrix", "client", "v3", "rooms", roomID, "joined_members",
    })
    members := client.ParseJSON(t, res).Get("joined")
    if !members.Get(client.GjsonEscape(alice)).Exists() ||
        !members.Get(client.GjsonEscape(bob)).Exists() ||
        members.Get(client.GjsonEscape(outsider)).Exists() {
        t.Fatal("actual two-Synapse room membership/outsider boundary failed")
    }
}

func TestPB3TwoSynapseFederationReadOnly(t *testing.T) {
    // This deploys exactly TWO independent real Docker homeservers, not mocked fetch,
    // and uses real Matrix Client-Server + Server-Server federation transactions.
    deployment := complement.Deploy(t, 2)
    defer deployment.Destroy(t)

    alice := deployment.Register(t, "hs1", helpers.RegistrationOpts{})
    bob := deployment.Register(t, "hs2", helpers.RegistrationOpts{})
    outsider := deployment.Register(t, "hs2", helpers.RegistrationOpts{})
    if alice.UserID == bob.UserID ||
        alice.UserID == outsider.UserID ||
        bob.UserID == outsider.UserID ||
        alice.BaseURL == bob.BaseURL {
        t.Fatal("homeservers or disposable authenticated identities not independent")
    }

    roomID := alice.MustCreateRoom(t, map[string]interface{}{
        "preset": "private_chat",
        "visibility": "private",
        "initial_state": []interface{}{
            map[string]interface{}{
                "type": "m.room.encryption",
                "state_key": "",
                "content": map[string]interface{}{
                    "algorithm": "m.megolm.v1.aes-sha2",
                },
            },
        },
    })

    // Private room, outsider C is never invited. Bob is explicitly invited and
    // joins through the real federated host's server name.
    alice.MustInviteRoom(t, roomID, bob.UserID)
    bob.MustJoinRoom(t, roomID, []spec.ServerName{
        deployment.GetFullyQualifiedHomeserverName(t, "hs1"),
    })
    alice.MustSyncUntil(t, client.SyncReq{},
        client.SyncJoinedTo(bob.UserID, roomID))
    bob.MustSyncUntil(t, client.SyncReq{},
        client.SyncJoinedTo(bob.UserID, roomID))

    pb3AssertMembership(t, alice, roomID, alice.UserID, bob.UserID, outsider.UserID)
    pb3AssertMembership(t, bob, roomID, alice.UserID, bob.UserID, outsider.UserID)

    // Dummy inert Megolm-looking event: proves real SS-API transport, NOT crypto.
    eventID := alice.SendEventSynced(t, roomID, b.Event{
        Type: "m.room.encrypted", Sender: alice.UserID,
        Content: map[string]interface{}{
            "algorithm": "m.megolm.v1.aes-sha2",
            "ciphertext": "pb3_disposable_noncryptographic_envelope",
            "session_id": "disposable_session",
            "sender_key": "disposable_sender_key",
        },
    })
    bob.MustSyncUntil(t, client.SyncReq{}, client.SyncTimelineHasEventID(roomID, eventID))
    pb3AssertEvent(t, alice, roomID, eventID, alice.UserID)
    pb3AssertEvent(t, bob, roomID, eventID, alice.UserID)

    // Outsider's valid account must be *denied* despite sharing Bob's homeserver.
    // An unauthenticated 401 would not prove member ACL, so only 403/404 count.
    outsiderEvent := outsider.Do(t, "GET", []string{
        "_matrix", "client", "v3", "rooms", roomID, "event", eventID,
    })
    defer outsiderEvent.Body.Close()
    if outsiderEvent.StatusCode != http.StatusForbidden &&
        outsiderEvent.StatusCode != http.StatusNotFound {
        t.Fatalf("outsider read was not forbidden (HTTP %d)", outsiderEvent.StatusCode)
    }

    // A real non-invited /join must fail as well; opening a public room would
    // invalidate the negative ACL assertion.
    outsiderJoin := outsider.JoinRoom(t, roomID, []spec.ServerName{
        deployment.GetFullyQualifiedHomeserverName(t, "hs1"),
    })
    defer outsiderJoin.Body.Close()
    if outsiderJoin.StatusCode != http.StatusForbidden &&
        outsiderJoin.StatusCode != http.StatusNotFound {
        t.Fatalf("uninvited outsider joined or bypassed room rules (HTTP %d)", outsiderJoin.StatusCode)
    }

    // Intentionally no "E2EE passed" log: a dummy ciphertext is not a decrypt proof.
    t.Log("PB3_REAL_TWO_SYNAPSE_TRANSPORT_PASS: two disposable federated Synapse instances, membership, envelope and outsider denial; SDK E2EE NOT TESTED")
}
