import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  RotateCw,
  X,
} from "lucide-react";
import TextLayer from "./TextLayer";
import { useDialog } from "./useDialog";
import "./shared.css";

type User = { id: string; displayName: string; workspaceOwner: boolean };
type Page = { width: number; height: number; rotation: number };
type Span = {
  text: string;
  bbox: number[];
  size: number;
  font: string;
  color: number;
};
type State = {
  id: string;
  name: string;
  version: number;
  role: string;
  document: { pages: Page[]; pageCount: number };
  comments: {
    id: string;
    author: string;
    text: string;
    page: number;
    resolved: boolean;
  }[];
  members?: { id: string; displayName: string; role: string }[];
};
type Summary = Pick<State, "id" | "name" | "version" | "role">;
type Mutation = {
  path: string;
  body: Record<string, unknown>;
  method?: string;
  version: number;
};
async function api<T>(
  path: string,
  body?: unknown,
  method = "POST",
): Promise<T> {
  const response = await fetch(
    `/api${path}`,
    body === undefined
      ? { cache: "no-store" }
      : {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw Object.assign(
      new Error(
        typeof data.detail === "string"
          ? data.detail
          : data.detail?.message || "Could not complete this request.",
      ),
      { status: response.status },
    );
  return data;
}
export default function SharedWorkspace({
  localDocument,
  onClose,
}: {
  localDocument: { id: string; name: string } | null;
  onClose: () => void;
}) {
  const [user, setUser] = useState<User | null>(null),
    [ready, setReady] = useState(false);
  const [signup, setSignup] = useState(false),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [displayName, setDisplayName] = useState("");
  const [documents, setDocuments] = useState<Summary[]>([]),
    [state, setState] = useState<State | null>(null);
  const stateRef = useRef<State | null>(null),
    active = useRef(true),
    busyRef = useRef(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [sync, setSync] = useState("");
  const [pageIndex, setPageIndex] = useState(0),
    [zoom, setZoom] = useState(0.85),
    [spans, setSpans] = useState<Span[]>([]);
  const [mode, setMode] = useState("read"),
    [selected, setSelected] = useState<Span | null>(null),
    [replacement, setReplacement] = useState("");
  const [selectionVersion, setSelectionVersion] = useState(0),
    [comment, setComment] = useState(""),
    [commentVersion, setCommentVersion] = useState<number | null>(null);
  const [pending, setPending] = useState<Mutation | null>(null),
    [inviteRole, setInviteRole] = useState("editor"),
    [inviteLink, setInviteLink] = useState("");
  const [presence, setPresence] = useState<
    { userId: string; displayName: string; page: number }[]
  >([]);
  const [invitations, setInvitations] = useState<
    { id: string; role: string; expires: number }[]
  >([]);
  const invite = useRef(new URLSearchParams(location.search).get("invite"));
  const joining = useRef(false);
  useDialog(true, onClose);
  function accept(next: State) {
    if (!active.current) return;
    if (
      stateRef.current?.id === next.id &&
      stateRef.current.version > next.version
    )
      return;
    stateRef.current = next;
    setState(next);
    setPageIndex((index) => Math.min(index, next.document.pageCount - 1));
  }
  function clearDocument() {
    stateRef.current = null;
    setState(null);
    setSpans([]);
    setSelected(null);
    setComment("");
    setCommentVersion(null);
    setPending(null);
    setInviteLink("");
    setPresence([]);
    setPageIndex(0);
  }
  async function run(action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      busyRef.current = false;
      if (active.current) setBusy(false);
    }
  }
  async function list() {
    const result = await api<{ documents: Summary[] }>("/shared");
    if (active.current) setDocuments(result.documents);
  }
  async function listInvitations(id: string) {
    const result = await api<{ invites: typeof invitations }>(
      `/shared/${id}/invites`,
    );
    if (active.current && stateRef.current?.id === id)
      setInvitations(result.invites);
  }
  async function signedIn() {
    const result = await api<{ user: User }>("/auth/me");
    if (!active.current) return;
    setUser(result.user);
    if (result.user.workspaceOwner)
      window.dispatchEvent(new Event("folio-owner-authenticated"));
    if (!result.user.workspaceOwner)
      window.dispatchEvent(new Event("folio-local-session-ended"));
    await list();
    if (invite.current && !joining.current) {
      joining.current = true;
      try {
        const next = await api<State>("/shared/join", {
          token: invite.current,
        });
        accept(next);
        invite.current = null;
        const url = new URL(location.href);
        url.searchParams.delete("invite");
        history.replaceState(null, "", url);
        await list();
      } finally {
        joining.current = false;
      }
    }
  }
  useEffect(() => {
    active.current = true;
    signedIn()
      .catch((e) => {
        if (e.status !== 401) setError(e.message);
      })
      .finally(() => setReady(true));
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    setInvitations([]);
    if (state?.role === "owner")
      void listInvitations(state.id).catch((e) => setError(e.message));
  }, [
    state?.id,
    state?.version,
    state?.members?.map((member) => member.id).join(","),
  ]);
  useEffect(() => {
    if (!state?.id) return;
    const id = state.id;
    let live = true;
    const refresh = async () => {
      try {
        const next = await api<State>(`/shared/${id}`);
        if (live && stateRef.current?.id === id) {
          accept(next);
          setSync("All changes saved");
        }
      } catch (e) {
        if (!live) return;
        const problem = e as Error & { status: number };
        if ([401, 403, 404].includes(problem.status)) {
          clearDocument();
          setError(
            "Access to this shared PDF has ended. Sign in again or ask its owner for an invitation.",
          );
        } else setSync("Connection interrupted · trying again");
      }
    };
    const ping = async () => {
      try {
        const result = await api<{ presence: typeof presence }>(
          `/shared/${id}/presence`,
          { page: pageIndex },
        );
        if (live) setPresence(result.presence);
      } catch {
        /* State poll handles expired access. */
      }
    };
    void refresh();
    void ping();
    const timer = setInterval(refresh, 2000),
      heartbeat = setInterval(ping, 10000);
    return () => {
      live = false;
      clearInterval(timer);
      clearInterval(heartbeat);
    };
  }, [state?.id, pageIndex]);
  useEffect(() => {
    setSpans([]);
    if (!state) return;
    const controller = new AbortController();
    fetch(
      `/api/shared/${state.id}/pages/${pageIndex}/text?v=${state.version}`,
      { signal: controller.signal, cache: "no-store" },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load page text.");
        return response.json();
      })
      .then((data) => setSpans(data.spans))
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => controller.abort();
  }, [state?.id, state?.version, pageIndex]);
  async function mutate(operation: Mutation) {
    try {
      const next = await api<State>(
        operation.path,
        { ...operation.body, expectedVersion: operation.version },
        operation.method || "POST",
      );
      accept(next);
      setPending(null);
      setSelected(null);
      setComment("");
      setCommentVersion(null);
      setSync("All changes saved");
    } catch (e) {
      if ((e as { status: number }).status === 409) {
        setPending(operation);
        if (stateRef.current)
          accept(await api<State>(`/shared/${stateRef.current.id}`));
        setError(
          "Someone changed this PDF while you were working. Review the latest page before retrying your change.",
        );
      } else throw e;
    }
  }
  const page = state?.document.pages[pageIndex],
    canEdit = state && ["owner", "editor"].includes(state.role),
    canComment = state && state.role !== "viewer";
  const edit = (payload: unknown, version = state!.version) =>
    run(() =>
      mutate({
        path: `/shared/${state!.id}/edit`,
        body: { edit: payload },
        version,
      }),
    );
  return (
    <section
      className="shared-workspace"
      role="dialog"
      aria-modal="true"
      aria-label="Shared workspace"
    >
      <header className="shared-header">
        <div>
          <strong>Shared workspace</strong>
          <small>One PDF. Everyone on the same page.</small>
        </div>
        <div className="shared-actions">
          {user && (
            <>
              <span>{user.displayName}</span>
              <button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await api("/auth/logout", {});
                    clearDocument();
                    setUser(null);
                    setDocuments([]);
                    window.dispatchEvent(
                      new Event("folio-local-session-ended"),
                    );
                  })
                }
              >
                Sign out
              </button>
            </>
          )}
          <button aria-label="Close shared workspace" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
      </header>
      {error && (
        <div className="shared-message" role="alert">
          {error}
        </div>
      )}
      {pending && (
        <div className="shared-message">
          Your change has not been applied.{" "}
          <button
            disabled={busy || !state}
            onClick={() =>
              run(() => mutate({ ...pending, version: state!.version }))
            }
          >
            Retry on latest version
          </button>
          <button
            onClick={() => {
              setPending(null);
              setError("");
              setSelected(null);
            }}
          >
            Discard pending change
          </button>
        </div>
      )}
      {!ready ? (
        <p className="shared-empty">Opening workspace…</p>
      ) : !user ? (
        <form
          className="shared-auth"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await api(`/auth/${signup ? "signup" : "login"}`, {
                username,
                password,
                displayName,
              });
              setPassword("");
              await signedIn();
            });
          }}
        >
          <h1>{signup ? "Create your account" : "Welcome back"}</h1>
          <p>
            Sign in to work on PDFs with your team.
            {invite.current && " Your invitation will open after you sign in."}
          </p>
          <label>
            Username
            <input
              required
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          {signup && (
            <label>
              Your name
              <input
                required
                autoComplete="name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </label>
          )}
          <label>
            Password
            <input
              required
              minLength={signup ? 10 : undefined}
              type="password"
              autoComplete={signup ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button className="shared-primary" disabled={busy}>
            {signup ? "Create account" : "Sign in"}
          </button>
          <button type="button" onClick={() => setSignup(!signup)}>
            {signup ? "Already have an account? Sign in" : "Create an account"}
          </button>
        </form>
      ) : !state ? (
        <main className="shared-list">
          <h1>Your shared PDFs</h1>
          <p>Changes and comments are saved for everyone with access.</p>
          {localDocument && user.workspaceOwner && (
            <button
              className="shared-primary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  clearDocument();
                  accept(
                    await api<State>("/shared", {
                      documentId: localDocument.id,
                      name: localDocument.name,
                    }),
                  );
                  await list();
                })
              }
            >
              Share “{localDocument.name}”
            </button>
          )}
          <div>
            {documents.map((item) => (
              <button
                className="shared-document"
                data-shared-id={item.id}
                key={item.id}
                onClick={() =>
                  run(async () => {
                    clearDocument();
                    accept(await api<State>(`/shared/${item.id}`));
                  })
                }
              >
                <strong>{item.name}</strong>
                <span>
                  {item.role} · version {item.version}
                </span>
              </button>
            ))}
          </div>
          {!documents.length && (
            <p>No shared PDFs yet. Open a PDF, then choose Share.</p>
          )}
        </main>
      ) : (
        <>
          <div className="shared-document-bar">
            <button
              aria-label="Back to shared PDFs"
              onClick={() => {
                clearDocument();
                void run(list);
              }}
            >
              <ArrowLeft size={18} />
            </button>
            <strong>{state.name}</strong>
            <span className="shared-role">{state.role}</span>
            <span className="shared-save" role="status">
              {busy ? "Saving…" : sync} · Version {state.version}
            </span>
            <a href={`/api/shared/${state.id}/file`} download>
              Download PDF
            </a>
          </div>
          <div className="shared-body">
            <main className="shared-main">
              <nav className="shared-tools" aria-label="Shared PDF tools">
                <button
                  aria-label="Previous shared page"
                  disabled={!pageIndex}
                  onClick={() => {
                    setSelected(null);
                    setPageIndex(pageIndex - 1);
                  }}
                >
                  <ChevronLeft size={17} />
                </button>
                <span>
                  {pageIndex + 1} / {state.document.pageCount}
                </span>
                <button
                  aria-label="Next shared page"
                  disabled={pageIndex + 1 >= state.document.pageCount}
                  onClick={() => {
                    setSelected(null);
                    setPageIndex(pageIndex + 1);
                  }}
                >
                  <ChevronRight size={17} />
                </button>
                <select
                  aria-label="Shared PDF zoom"
                  value={zoom}
                  onChange={(e) => setZoom(Number(e.target.value))}
                >
                  {[0.5, 0.65, 0.85, 1, 1.25, 1.5, 2].map((value) => (
                    <option key={value} value={value}>
                      {Math.round(value * 100)}%
                    </option>
                  ))}
                </select>
                <button
                  aria-pressed={mode === "read"}
                  onClick={() => {
                    setMode("read");
                    setSelected(null);
                  }}
                >
                  Read
                </button>
                {canEdit && (
                  <button
                    aria-pressed={mode === "edit"}
                    onClick={() => setMode("edit")}
                  >
                    Edit text
                  </button>
                )}
                {canComment && (
                  <button
                    aria-pressed={mode === "highlight"}
                    onClick={() => setMode("highlight")}
                  >
                    Highlight
                  </button>
                )}
                {canEdit && (
                  <button
                    disabled={busy || !!pending}
                    onClick={() =>
                      edit({
                        operation: "rotate",
                        pages: [pageIndex],
                        angle: 90,
                      })
                    }
                  >
                    <RotateCw size={15} /> Rotate page
                  </button>
                )}
              </nav>
              <div className="shared-canvas">
                {page && (
                  <div
                    className="shared-paper"
                    style={{
                      width:
                        (page.rotation % 180 ? page.height : page.width) * zoom,
                      height:
                        (page.rotation % 180 ? page.width : page.height) * zoom,
                    }}
                  >
                    <img
                      alt={`Shared PDF page ${pageIndex + 1}`}
                      src={`/api/shared/${state.id}/pages/${pageIndex}/render?v=${state.version}&scale=${Math.min(3, zoom * 1.6)}`}
                    />
                    {mode === "read" ? (
                      <TextLayer spans={spans} page={page} zoom={zoom} />
                    ) : (
                      <div
                        className="shared-span-layer"
                        style={{
                          width: page.width * zoom,
                          height: page.height * zoom,
                          transform:
                            page.rotation === 90
                              ? `translateX(${page.height * zoom}px) rotate(90deg)`
                              : page.rotation === 180
                                ? `translate(${page.width * zoom}px,${page.height * zoom}px) rotate(180deg)`
                                : page.rotation === 270
                                  ? `translateY(${page.width * zoom}px) rotate(270deg)`
                                  : undefined,
                        }}
                      >
                        {spans.map((span, index) => (
                          <button
                            key={index}
                            aria-label={`${mode === "edit" ? "Edit" : "Highlight"} ${span.text}`}
                            disabled={busy || !!pending}
                            style={{
                              left: span.bbox[0] * zoom,
                              top: span.bbox[1] * zoom,
                              width: (span.bbox[2] - span.bbox[0]) * zoom,
                              height: (span.bbox[3] - span.bbox[1]) * zoom,
                            }}
                            onClick={() => {
                              if (mode === "highlight")
                                void edit({
                                  operation: "annotate",
                                  kind: "highlight",
                                  page: pageIndex,
                                  rect: span.bbox,
                                  color: [1, 0.85, 0.2],
                                });
                              else {
                                setSelected(span);
                                setReplacement(span.text);
                                setSelectionVersion(state.version);
                              }
                            }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </main>
            <aside className="shared-sidebar">
              <section>
                <h2>Here now</h2>
                <p className="shared-presence">
                  {presence
                    .map(
                      (person) =>
                        `${person.displayName}${person.userId === user.id ? " (you)" : ""} · p. ${person.page + 1}`,
                    )
                    .join(" · ") || "Connecting…"}
                </p>
              </section>
              {selected && canEdit && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void edit(
                      {
                        operation: "text",
                        page: pageIndex,
                        rect: selected.bbox,
                        text: replacement,
                        fontSize: selected.size,
                        color: [
                          ((selected.color >> 16) & 255) / 255,
                          ((selected.color >> 8) & 255) / 255,
                          (selected.color & 255) / 255,
                        ],
                      },
                      selectionVersion,
                    );
                  }}
                >
                  <h2>Edit selection</h2>
                  <label>
                    Replacement text
                    <textarea
                      value={replacement}
                      onChange={(e) => setReplacement(e.target.value)}
                    />
                  </label>
                  <button
                    className="shared-primary"
                    disabled={busy || !!pending}
                  >
                    Save text
                  </button>
                  <button type="button" onClick={() => setSelected(null)}>
                    Cancel
                  </button>
                </form>
              )}
              <section>
                <h2>Conversation</h2>
                {state.comments.map((item) => (
                  <article
                    key={item.id}
                    className={`shared-comment ${item.resolved ? "resolved" : ""}`}
                  >
                    <strong>{item.author}</strong>
                    <button
                      onClick={() => {
                        setSelected(null);
                        setPageIndex(item.page);
                      }}
                    >
                      Page {item.page + 1}
                    </button>
                    <p>{item.text}</p>
                    {item.resolved ? (
                      <small>Resolved</small>
                    ) : (
                      canComment && (
                        <button
                          disabled={busy || !!pending}
                          onClick={() =>
                            run(() =>
                              mutate({
                                path: `/shared/${state.id}/comments/${item.id}`,
                                method: "PATCH",
                                body: { resolved: true },
                                version: state.version,
                              }),
                            )
                          }
                        >
                          Resolve
                        </button>
                      )
                    )}
                  </article>
                ))}
                {!state.comments.length && <p>No comments yet.</p>}
                {canComment ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void run(() =>
                        mutate({
                          path: `/shared/${state.id}/comments`,
                          body: { text: comment, page: pageIndex },
                          version: commentVersion ?? state.version,
                        }),
                      );
                    }}
                  >
                    <label>
                      Comment on page {pageIndex + 1}
                      <textarea
                        required
                        value={comment}
                        onChange={(e) => {
                          setComment(e.target.value);
                          if (commentVersion === null)
                            setCommentVersion(state.version);
                        }}
                      />
                    </label>
                    <button
                      className="shared-primary"
                      disabled={!comment.trim() || busy || !!pending}
                    >
                      Post comment
                    </button>
                  </form>
                ) : (
                  <p>You have view-only access.</p>
                )}
              </section>
              {state.role === "owner" && (
                <section>
                  <h2>People & access</h2>
                  {state.members?.map((member) => (
                    <div className="shared-member" key={member.id}>
                      <span>
                        {member.displayName}
                        <small>{member.role}</small>
                      </span>
                      {member.id !== user.id && (
                        <button
                          disabled={busy}
                          aria-label={`Remove ${member.displayName}`}
                          onClick={() =>
                            run(async () => {
                              accept(
                                await api<State>(
                                  `/shared/${state.id}/members/${member.id}`,
                                  {},
                                  "DELETE",
                                ),
                              );
                            })
                          }
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
                  <label>
                    Invite permission
                    <select
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value)}
                    >
                      <option value="editor">Can edit</option>
                      <option value="commenter">Can comment</option>
                      <option value="viewer">Can view</option>
                    </select>
                  </label>
                  <button
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const result = await api<{ token: string }>(
                          `/shared/${state.id}/invites`,
                          { role: inviteRole },
                        );
                        setInviteLink(
                          `${location.origin}${location.pathname}?invite=${encodeURIComponent(result.token)}`,
                        );
                        await listInvitations(state.id);
                      })
                    }
                  >
                    Create invitation
                  </button>
                  {inviteLink && (
                    <label>
                      One-use invitation link
                      <input
                        aria-label="One-use invitation link"
                        readOnly
                        value={inviteLink}
                        onFocus={(e) => e.target.select()}
                      />
                      <small>Share with one person. Expires in 24 hours.</small>
                      <button
                        onClick={() =>
                          run(async () => {
                            await navigator.clipboard.writeText(inviteLink);
                            setSync("Invitation copied");
                          })
                        }
                      >
                        Copy invitation
                      </button>
                    </label>
                  )}
                  {invitations.length > 0 && (
                    <div className="shared-pending-invites">
                      <h2>Pending invitations</h2>
                      {invitations.map((invitation, index) => (
                        <div className="shared-member" key={invitation.id}>
                          <span>
                            {invitation.role}
                            <small>
                              Expires{" "}
                              {new Date(
                                invitation.expires * 1000,
                              ).toLocaleDateString()}
                            </small>
                          </span>
                          <button
                            disabled={busy}
                            aria-label={`Cancel ${invitation.role} invitation ${index + 1}`}
                            onClick={() =>
                              run(async () => {
                                await api(
                                  `/shared/${state.id}/invites/${invitation.id}`,
                                  {},
                                  "DELETE",
                                );
                                setInviteLink("");
                                await listInvitations(state.id);
                              })
                            }
                          >
                            Cancel invitation
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )}
            </aside>
          </div>
        </>
      )}
    </section>
  );
}
