import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import type { SubscriptionTier } from "@/types/chat";

let mockSubscription: SubscriptionTier;
let mockMaxEntitlement: unknown;
let mockIsMobile: boolean;
const mockUseQuery = jest.fn((_query: unknown, args: unknown) =>
  args === "skip" ? undefined : mockMaxEntitlement,
);
const mockRedirectToPricing = jest.fn();
const mockOpenSettingsDialog = jest.fn();

Object.defineProperty(globalThis, "ResizeObserver", {
  configurable: true,
  value: class ResizeObserverMock {
    observe() {
      return undefined;
    }

    unobserve() {
      return undefined;
    }

    disconnect() {
      return undefined;
    }
  },
});

jest.mock("@/app/contexts/GlobalState", () => ({
  useGlobalState: () => ({
    subscription: mockSubscription,
  }),
}));

jest.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => mockIsMobile,
}));

jest.mock("@/app/hooks/usePricingDialog", () => ({
  redirectToPricing: (...args: unknown[]) => mockRedirectToPricing(...args),
}));

jest.mock("@/lib/utils/settings-dialog", () => ({
  openSettingsDialog: (...args: unknown[]) => mockOpenSettingsDialog(...args),
}));

jest.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
}));

const { ModelSelector } = jest.requireActual<
  typeof import("../../ModelSelector")
>("../../ModelSelector");

/**
 * O seletor expõe Auto + modelos CONCRETOS (seletor do operador). Os tiers
 * (hackerai-standard/pro/max) não são mais oferecidos, então o fluxo de
 * entitlement do Max é inalcançável pelo seletor — a cobertura aqui foca no
 * comportamento novo: escolher um modelo concreto, Auto first-class, e o
 * bloqueio de usuário free (que ainda vale para TODAS as opções).
 */
describe("ModelSelector", () => {
  beforeEach(() => {
    mockSubscription = "pro-plus";
    mockMaxEntitlement = undefined;
    mockIsMobile = false;
    mockUseQuery.mockClear();
    mockRedirectToPricing.mockClear();
    mockOpenSettingsDialog.mockClear();
  });

  it("skips the Max entitlement query until a paid user opens the selector", () => {
    render(<ModelSelector value="auto" onChange={jest.fn()} mode="agent" />);

    expect(mockUseQuery).toHaveBeenLastCalledWith(expect.anything(), "skip");

    fireEvent.click(screen.getByRole("button", { name: /^Auto$/i }));

    expect(mockUseQuery).toHaveBeenLastCalledWith(expect.anything(), {});
  });

  it("shows Auto plus the concrete model choices while Auto is selected", () => {
    render(<ModelSelector value="auto" onChange={jest.fn()} mode="ask" />);

    fireEvent.click(screen.getByRole("button", { name: /^Auto$/i }));

    expect(
      screen.getByText(
        "Balanced quality and speed, recommended for most tasks",
      ),
    ).toBeVisible();
    expect(screen.getByText("xAI Grok 4.6")).toBeVisible();
    expect(screen.getByText("xAI Grok 4.7")).toBeVisible();
    expect(screen.getByText("Z.ai GLM 5.3")).toBeVisible();
    expect(screen.getByText("DeepSeek V4.1 Flash")).toBeVisible();
    expect(screen.getByText("Moonshot Kimi K3")).toBeVisible();

    expect(
      screen.getByRole("button", { name: /xAI Grok 4\.6/i }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("discloses the underlying provider of a concrete model on hover", async () => {
    const user = userEvent.setup();
    render(<ModelSelector value="auto" onChange={jest.fn()} mode="agent" />);

    fireEvent.click(screen.getByRole("button", { name: /^Auto$/i }));

    await user.hover(screen.getByRole("button", { name: /Moonshot Kimi K3/i }));
    expect(
      await screen.findAllByText("Powered by Moonshot"),
    ).not.toHaveLength(0);

    await user.unhover(
      screen.getByRole("button", { name: /Moonshot Kimi K3/i }),
    );
    await user.hover(screen.getByRole("button", { name: /xAI Grok 4\.7/i }));
    expect(
      await screen.findAllByText("Powered by xAI · 500k contexto"),
    ).not.toHaveLength(0);
  });

  it("selects Auto as a first-class option", () => {
    const onChange = jest.fn();
    render(
      <ModelSelector value="model-grok-4.6" onChange={onChange} mode="ask" />,
    );

    fireEvent.click(screen.getByRole("button", { name: /xAI Grok 4\.6/i }));
    fireEvent.click(
      screen.getByRole("button", {
        name: /Auto Balanced quality and speed/i,
      }),
    );

    expect(onChange).toHaveBeenCalledWith("auto");
  });

  it("selects a concrete model in ask mode without a high-cost warning", () => {
    const onChange = jest.fn();
    render(<ModelSelector value="auto" onChange={onChange} mode="ask" />);

    fireEvent.click(screen.getByRole("button", { name: /^Auto$/i }));
    fireEvent.click(screen.getByRole("button", { name: /DeepSeek V4 Pro/i }));

    expect(
      screen.queryByTestId("high-cost-model-warning"),
    ).not.toBeInTheDocument();
    expect(onChange).toHaveBeenCalledWith("model-deepseek-v4-pro-0813");
  });

  it("selects the new Grok 4.7 in agent mode without a high-cost warning", () => {
    const onChange = jest.fn();
    render(<ModelSelector value="auto" onChange={onChange} mode="agent" />);

    fireEvent.click(screen.getByRole("button", { name: /^Auto$/i }));
    fireEvent.click(screen.getByRole("button", { name: /xAI Grok 4\.7/i }));

    expect(
      screen.queryByTestId("high-cost-model-warning"),
    ).not.toBeInTheDocument();
    expect(onChange).toHaveBeenCalledWith("model-grok-4.7");
  });

  it("selects the new DeepSeek V4.1 Flash in agent mode", () => {
    const onChange = jest.fn();
    render(<ModelSelector value="auto" onChange={onChange} mode="agent" />);

    fireEvent.click(screen.getByRole("button", { name: /^Auto$/i }));
    fireEvent.click(
      screen.getByRole("button", { name: /DeepSeek V4\.1 Flash/i }),
    );

    expect(onChange).toHaveBeenCalledWith("model-deepseek-v4.1-flash");
  });

  it("lets an Ultra user select any concrete model", () => {
    mockSubscription = "ultra";
    const onChange = jest.fn();
    render(<ModelSelector value="auto" onChange={onChange} mode="agent" />);

    fireEvent.click(screen.getByRole("button", { name: /^Auto$/i }));
    fireEvent.click(screen.getByRole("button", { name: /Z\.ai GLM 5\.3(?! Flash)/i }));

    expect(onChange).toHaveBeenCalledWith("model-glm-5.3");
    expect(mockRedirectToPricing).not.toHaveBeenCalled();
  });

  // ── Modelos GRATUITOS (grupo separado; bloqueados em chat de engajamento) ──

  it("mostra o grupo GRATUITO com o selo de política de dados para usuário pago", () => {
    mockSubscription = "ultra";
    render(<ModelSelector value="auto" onChange={jest.fn()} mode="agent" />);
    fireEvent.click(screen.getByRole("button", { name: /^Auto$/i }));

    expect(
      screen.getByText(/Gratuitos · podem treinar com o prompt/i),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /NVIDIA Nemotron 3 Ultra/i }),
    ).toBeEnabled();
    expect(
      screen.queryByTestId("free-models-blocked-notice"),
    ).not.toBeInTheDocument();
  });

  it("seleciona um modelo GRATUITO em chat sem engajamento", () => {
    mockSubscription = "ultra";
    const onChange = jest.fn();
    render(<ModelSelector value="auto" onChange={onChange} mode="agent" />);
    fireEvent.click(screen.getByRole("button", { name: /^Auto$/i }));
    fireEvent.click(screen.getByRole("button", { name: /Qwen 3\.8 27B/i }));

    expect(onChange).toHaveBeenCalledWith("model-qwen3.8-27b-free");
  });

  it("em chat de ENGAJAMENTO: free fica bloqueado, aviso aparece e não seleciona", () => {
    mockSubscription = "ultra";
    const onChange = jest.fn();
    render(
      <ModelSelector
        value="auto"
        onChange={onChange}
        mode="agent"
        engagementBound
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Auto$/i }));

    expect(screen.getByTestId("free-models-blocked-notice")).toBeVisible();
    const blocked = screen.getByRole("button", {
      name: /Qwen 3\.8 27B\. Bloqueado/i,
    });
    expect(blocked).toBeDisabled();
    fireEvent.click(blocked);
    expect(onChange).not.toHaveBeenCalled();
    // Os pagos continuam selecionáveis normalmente.
    fireEvent.click(screen.getByRole("button", { name: /xAI Grok 4\.7/i }));
    expect(onChange).toHaveBeenCalledWith("model-grok-4.7");
  });

  it("em chat de ENGAJAMENTO um free previamente escolhido é exibido como Auto (não mente)", () => {
    mockSubscription = "ultra";
    render(
      <ModelSelector
        value="model-qwen3.8-27b-free"
        onChange={jest.fn()}
        mode="agent"
        engagementBound
      />,
    );
    // O gatilho não pode exibir o free como ativo — o servidor rebaixa p/ auto.
    expect(screen.getByRole("button", { name: /^Auto$/i })).toBeVisible();
  });

  it("em chat de ENGAJAMENTO normaliza o estado REAL para Auto (onChange), não só a exibição", () => {
    mockSubscription = "ultra";
    const onChange = jest.fn();
    render(
      <ModelSelector
        value="model-qwen3.8-27b-free"
        onChange={onChange}
        mode="agent"
        engagementBound
      />,
    );
    expect(onChange).toHaveBeenCalledWith("auto");
  });

  it("o grupo GRATUITO exibe o selo 'Grátis' em cada opção", () => {
    mockSubscription = "ultra";
    render(<ModelSelector value="auto" onChange={jest.fn()} mode="agent" />);
    fireEvent.click(screen.getByRole("button", { name: /^Auto$/i }));
    expect(screen.getAllByText("Grátis").length).toBeGreaterThanOrEqual(4);
  });

  it("usuário de PLANO free não vê o grupo gratuito", () => {
    mockSubscription = "free";
    render(<ModelSelector value="auto" onChange={jest.fn()} mode="ask" />);
    fireEvent.click(screen.getByRole("button", { name: /^Model$/i }));
    expect(
      screen.queryByText(/Gratuitos · podem treinar com o prompt/i),
    ).not.toBeInTheDocument();
  });

  it("MOBILE em chat de engajamento: free bloqueado e aviso no Sheet", () => {
    mockSubscription = "ultra";
    mockIsMobile = true;
    const onChange = jest.fn();
    render(
      <ModelSelector
        value="auto"
        onChange={onChange}
        mode="agent"
        engagementBound
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Auto$/i }));
    expect(screen.getByTestId("free-models-blocked-notice")).toBeVisible();
    const blocked = screen.getByRole("button", {
      name: /Qwen 3\.8 27B\. Bloqueado/i,
    });
    expect(blocked).toBeDisabled();
    fireEvent.click(blocked);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not display a stale concrete model as selected for free users", () => {
    mockSubscription = "free";

    render(
      <ModelSelector value="model-grok-4.6" onChange={jest.fn()} mode="agent" />,
    );

    // Free agent collapses to the Auto trigger, never the stale paid model.
    expect(screen.getByRole("button", { name: /^Auto$/i })).toBeVisible();
  });

  it("locks every concrete model for free users and routes to the upgrade CTA", () => {
    mockSubscription = "free";
    const onChange = jest.fn();
    render(<ModelSelector value="auto" onChange={onChange} mode="ask" />);

    fireEvent.click(screen.getByRole("button", { name: /^Model$/i }));
    fireEvent.click(screen.getByRole("button", { name: /xAI Grok 4\.6/i }));

    expect(onChange).not.toHaveBeenCalled();
    expect(mockRedirectToPricing).toHaveBeenCalledWith({
      surface: "model_selector",
      source: "locked_model_option",
      from_tier: "free",
      cta_text: "Upgrade your plan",
    });
  });
});
