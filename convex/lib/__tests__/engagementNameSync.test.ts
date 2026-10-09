import { describe, expect, it, jest } from "@jest/globals";
import {
  getSoleChatForEngagement,
  syncChatTitleFromEngagement,
  syncEngagementNameFromChat,
} from "../engagementNameSync";

type Chat = { _id: string; engagement_id?: string; title: string };
type Eng = { _id: string; name: string; name_locked?: boolean };

function makeCtx(opts: {
  chatsByEngagement?: Chat[];
  engagement?: Eng | null;
}) {
  const take = jest.fn<any>().mockResolvedValue(opts.chatsByEngagement ?? []);
  const eq = jest.fn<any>().mockReturnThis();
  const withIndex = jest.fn<any>((_name: string, apply: (q: any) => any) => {
    apply({ eq });
    return { take };
  });
  const query = jest.fn<any>().mockReturnValue({ withIndex });
  const get = jest.fn<any>().mockResolvedValue(opts.engagement ?? null);
  const patch = jest.fn<any>().mockResolvedValue(undefined);
  const ctx = { db: { query, get, patch } } as any;
  return { ctx, take, withIndex, query, get, patch, eq };
}

describe("getSoleChatForEngagement", () => {
  it("returns the chat when exactly one is attached (1:1)", async () => {
    const chat = { _id: "c1", title: "a" };
    const { ctx, withIndex, take } = makeCtx({ chatsByEngagement: [chat] });
    await expect(getSoleChatForEngagement(ctx, "e1" as any)).resolves.toEqual(
      chat,
    );
    expect(withIndex).toHaveBeenCalledWith(
      "by_engagement_and_updated",
      expect.any(Function),
    );
    // Só precisa distinguir 1 de "mais de 1" → take(2).
    expect(take).toHaveBeenCalledWith(2);
  });

  it("returns null when zero are attached", async () => {
    const { ctx } = makeCtx({ chatsByEngagement: [] });
    await expect(
      getSoleChatForEngagement(ctx, "e1" as any),
    ).resolves.toBeNull();
  });

  it("returns null when more than one is attached (grouped)", async () => {
    const { ctx } = makeCtx({
      chatsByEngagement: [
        { _id: "c1", title: "a" },
        { _id: "c2", title: "b" },
      ],
    });
    await expect(
      getSoleChatForEngagement(ctx, "e1" as any),
    ).resolves.toBeNull();
  });
});

describe("syncEngagementNameFromChat", () => {
  const chat: Chat = { _id: "c1", engagement_id: "e1", title: "Nova" };

  it("no-ops when the chat has no engagement", async () => {
    const { ctx, query, patch } = makeCtx({});
    await syncEngagementNameFromChat(
      ctx,
      { _id: "c1", title: "x" } as any,
      "x",
      { manual: true },
    );
    expect(query).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });

  it("no-ops when the engagement groups more than one chat (not 1:1)", async () => {
    const { ctx, get, patch } = makeCtx({
      chatsByEngagement: [chat, { _id: "c2", title: "b" }],
      engagement: { _id: "e1", name: "Old" },
    });
    await syncEngagementNameFromChat(ctx, chat as any, "Nova", {
      manual: true,
    });
    expect(get).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });

  it("no-ops when the sole chat is a different one", async () => {
    const { ctx, patch } = makeCtx({
      chatsByEngagement: [{ _id: "cOTHER", title: "b" }],
      engagement: { _id: "e1", name: "Old" },
    });
    await syncEngagementNameFromChat(ctx, chat as any, "Nova", {
      manual: true,
    });
    expect(patch).not.toHaveBeenCalled();
  });

  it("manual rename (1:1) updates the engagement name AND locks it", async () => {
    const { ctx, patch } = makeCtx({
      chatsByEngagement: [chat],
      engagement: { _id: "e1", name: "Old" },
    });
    await syncEngagementNameFromChat(ctx, chat as any, "  Nova  ", {
      manual: true,
    });
    expect(patch).toHaveBeenCalledWith("e1", {
      name: "Nova",
      name_locked: true,
      updated_at: expect.any(Number),
    });
  });

  it("auto-title (1:1, unlocked) updates the name but does NOT lock", async () => {
    const { ctx, patch } = makeCtx({
      chatsByEngagement: [chat],
      engagement: { _id: "e1", name: "Old" },
    });
    await syncEngagementNameFromChat(ctx, chat as any, "Nova", {
      manual: false,
    });
    expect(patch).toHaveBeenCalledWith("e1", {
      name: "Nova",
      updated_at: expect.any(Number),
    });
  });

  it("auto-title NEVER overwrites a manually-locked engagement name", async () => {
    const { ctx, patch } = makeCtx({
      chatsByEngagement: [chat],
      engagement: { _id: "e1", name: "Nome do operador", name_locked: true },
    });
    await syncEngagementNameFromChat(ctx, chat as any, "Auto title", {
      manual: false,
    });
    expect(patch).not.toHaveBeenCalled();
  });

  it("manual rename locks even when the name is unchanged", async () => {
    const { ctx, patch } = makeCtx({
      chatsByEngagement: [chat],
      engagement: { _id: "e1", name: "Nova" },
    });
    await syncEngagementNameFromChat(ctx, chat as any, "Nova", {
      manual: true,
    });
    expect(patch).toHaveBeenCalledWith("e1", {
      name_locked: true,
      updated_at: expect.any(Number),
    });
  });

  it("ignores an empty/whitespace title", async () => {
    const { ctx, patch } = makeCtx({
      chatsByEngagement: [chat],
      engagement: { _id: "e1", name: "Old" },
    });
    await syncEngagementNameFromChat(ctx, chat as any, "   ", {
      manual: true,
    });
    expect(patch).not.toHaveBeenCalled();
  });

  it("truncates the synced name to 100 characters", async () => {
    const { ctx, patch } = makeCtx({
      chatsByEngagement: [chat],
      engagement: { _id: "e1", name: "Old" },
    });
    await syncEngagementNameFromChat(ctx, chat as any, "x".repeat(150), {
      manual: false,
    });
    const call = patch.mock.calls[0]?.[1] as { name: string };
    expect(call.name).toHaveLength(100);
  });
});

describe("syncChatTitleFromEngagement", () => {
  it("mirrors the engagement name onto the sole chat (1:1)", async () => {
    const { ctx, patch } = makeCtx({
      chatsByEngagement: [{ _id: "c1", title: "Old" }],
    });
    await syncChatTitleFromEngagement(ctx, "e1" as any, "  Renomeado  ");
    expect(patch).toHaveBeenCalledWith("c1", {
      title: "Renomeado",
      update_time: expect.any(Number),
    });
  });

  it("no-ops when not 1:1 (zero or many chats)", async () => {
    const { ctx, patch } = makeCtx({ chatsByEngagement: [] });
    await syncChatTitleFromEngagement(ctx, "e1" as any, "Renomeado");
    expect(patch).not.toHaveBeenCalled();
  });

  it("no-ops when the title is already equal", async () => {
    const { ctx, patch } = makeCtx({
      chatsByEngagement: [{ _id: "c1", title: "Igual" }],
    });
    await syncChatTitleFromEngagement(ctx, "e1" as any, "Igual");
    expect(patch).not.toHaveBeenCalled();
  });
});
