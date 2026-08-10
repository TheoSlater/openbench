// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GenerativeTool } from "@/features/chat/components/Message/GenerativeTool";

describe("generative UI cards", () => {
  it("renders search-backed weather fields", () => {
    render(
      <GenerativeTool
        toolName="displayWeather"
        state="output-available"
        output={{
          location: "Tampa, United States",
          source: "web-search",
          temperature: 31.1,
          windSpeed: 4.5,
          condition: "Partly cloudy",
          summary: "Warm with passing clouds.",
          sourceTitle: "Tampa weather",
          sourceUrl: "https://example.com/tampa-weather",
        }}
      />,
    );

    expect(screen.getByText("31.1°C")).toBeTruthy();
    expect(screen.getByText("Partly cloudy")).toBeTruthy();
    expect(screen.getByText("Warm with passing clouds.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Tampa weather" }).getAttribute("href"))
      .toBe("https://example.com/tampa-weather");
  });

  it("renders structured stock fields", () => {
    render(
      <GenerativeTool
        toolName="getStockPrice"
        state="output-available"
        output={{
          symbol: "AAPL",
          source: "web-search",
          company: "Apple Inc.",
          price: 185.2,
          currency: "USD",
          change: 1.25,
          changePercent: 0.68,
          marketStatus: "Open",
          summary: "Apple traded higher in the latest session.",
        }}
      />,
    );

    expect(screen.getByText("Apple Inc.")).toBeTruthy();
    expect(screen.getByText(/185\.20/)).toBeTruthy();
    expect(screen.getByText("+1.25 (+0.68%)")).toBeTruthy();
    expect(screen.getByText("Apple traded higher in the latest session.")).toBeTruthy();
  });
});
