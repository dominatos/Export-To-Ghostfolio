import GhostfolioService from "./ghostfolioService";
import * as fs from "fs";

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch as any;

describe("GhostfolioService", () => {

    beforeAll(() => {
        process.env.GHOSTFOLIO_URL = "http://localhost:3333";
        process.env.GHOSTFOLIO_SECRET = "test-secret";
        process.env.GHOSTFOLIO_VALIDATE = "true";
        process.env.GHOSTFOLIO_IMPORT = "true";
    });

    beforeEach(() => {
        mockFetch.mockReset();
    });

    describe("authenticate", () => {

        it("should use POST with accessToken body for Ghostfolio v3+", async () => {
            // Arrange
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ authToken: "test-token-123" })
            });

            const service = new GhostfolioService();

            // Act - trigger authenticate via validate (which calls authenticate on 401)
            // First call: validate gets 401, triggers authenticate
            mockFetch.mockResolvedValueOnce({
                ok: true,
                status: 201,
                json: async () => ({})
            });

            // We need to call validate to trigger authenticate
            // But validate reads a file, so let's test authenticate indirectly
            // by checking the fetch call format

            // Access private method via any cast
            await (service as any).authenticate(true);

            // Assert
            expect(mockFetch).toHaveBeenCalledWith(
                "http://localhost:3333/api/v1/auth/anonymous",
                expect.objectContaining({
                    method: "POST",
                    headers: expect.arrayContaining([
                        ["Content-Type", "application/json"]
                    ]),
                    body: JSON.stringify({ accessToken: "test-secret" })
                })
            );
        });

        it("should throw on non-ok response", async () => {
            // Arrange
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 404,
                statusText: "Not Found"
            });

            const service = new GhostfolioService();

            // Act & Assert
            await expect((service as any).authenticate(true))
                .rejects.toThrow("Authentication failed: 404 Not Found");
        });

        it("should throw when authToken is missing from response", async () => {
            // Arrange
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({})  // no authToken
            });

            const service = new GhostfolioService();

            // Act & Assert
            await expect((service as any).authenticate(true))
                .rejects.toThrow("Authentication succeeded but no authToken was returned");
        });

        it("should cache token and not re-authenticate on subsequent calls", async () => {
            // Arrange
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ authToken: "cached-token" })
            });

            const service = new GhostfolioService();

            // Act - first call authenticates
            await (service as any).authenticate(true);
            expect(mockFetch).toHaveBeenCalledTimes(1);

            // Act - second call with refresh=false should skip
            await (service as any).authenticate(false);
            expect(mockFetch).toHaveBeenCalledTimes(1); // still 1
        });
    });

    describe("retryCount", () => {

        it("should stop after 3 retries (retryCount advances correctly)", async () => {
            // Arrange
            const service = new GhostfolioService();
            const tmpFile = "/tmp/test-validate.json";
            fs.writeFileSync(tmpFile, JSON.stringify({ activities: [] }));

            // Mock fetch: auth always succeeds, validate always returns 401
            mockFetch.mockImplementation(async (url: string) => {
                if (url.includes("/auth/anonymous")) {
                    return { ok: true, json: async () => ({ authToken: "token" }) };
                }
                // validate endpoint - always 401 to trigger retry
                return { ok: true, status: 401, json: async () => ({}) };
            });

            // Act & Assert - should throw after 3 retries (retryCount 0→1→2→3)
            await expect(service.validate(tmpFile, 0))
                .rejects.toThrow("Failed to validate export file because of authentication error");

            // Auth should have been called 3 times (retryCount 0→1→2, then 3 throws before auth)
            const authCalls = mockFetch.mock.calls.filter(
                (call: any) => call[0].includes("/auth/anonymous")
            );
            expect(authCalls.length).toBe(3);

            // Cleanup
            fs.unlinkSync(tmpFile);
        });
    });
});
