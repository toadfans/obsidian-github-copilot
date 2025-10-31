import CopilotPlugin from "../main";
import {
	sendMessage,
	SendMessageRequest,
	SendMessageResponse,
} from "../copilot-chat/api/sendMessage";
import {
	ModelOption,
	defaultModels,
} from "../copilot-chat/store/slices/message";
import SecureCredentialManager from "../helpers/SecureCredentialManager";

/**
 * API interface exposed to window for direct Copilot model access
 */
export interface CopilotAPIOptions {
	/** The message/prompt to send to the model */
	prompt: string;
	/** The model to use (defaults to current selected model) */
	model?: string;
	/** Temperature for response randomness (0-1, default: 0) */
	temperature?: number;
	/** Top-p sampling parameter (0-1, default: 1) */
	topP?: number;
	/** System prompt to set context (optional) */
	systemPrompt?: string;
	/** Additional message history for context (optional) */
	messageHistory?: Array<{
		role: "user" | "assistant" | "system";
		content: string;
	}>;
}

/**
 * API response interface
 */
export interface CopilotAPIResponse {
	/** The model's response text */
	content: string;
	/** The model used */
	model: string;
	/** Response ID */
	id: string;
	/** Token usage information */
	usage?: {
		promptTokens: number;
		completionTokens: number;
		totalTokens: number;
	};
}

/**
 * CopilotAPI class for direct model access
 */
export class CopilotAPI {
	private plugin: CopilotPlugin;
	public sendMessage = sendMessage;

	constructor(plugin: CopilotPlugin) {
		this.plugin = plugin;
	}

	/**
	 * Get the current access token (refreshes if needed)
	 */
	private async getAccessToken(): Promise<string> {
		const secureManager = SecureCredentialManager.getInstance();
		const credentials = await secureManager.getCredentials(this.plugin.app);

		if (!credentials?.pat) {
			throw new Error(
				"Not authenticated. Please authenticate first using the Copilot Chat view.",
			);
		}

		const accessToken = credentials.accessToken;
		const now = Date.now();
		const expiresAt = (accessToken?.expiresAt || 0) * 1000;

		// If token is expired or about to expire (within 5 minutes), refresh it
		if (!accessToken?.token || now >= expiresAt - 5 * 60 * 1000) {
			console.log("Refreshing access token...");
			const { fetchToken } = await import(
				"../copilot-chat/api/fetchToken"
			);
			const newTokenData = await fetchToken(credentials.pat);

			// Update stored credentials
			await secureManager.storeCredentials(
				{
					...credentials,
					accessToken: {
						token: newTokenData.token,
						expiresAt: newTokenData.expires_at,
					},
				},
				this.plugin.app,
			);

			return newTokenData.token;
		}

		return accessToken.token;
	}

	/**
	 * Get list of available models
	 */
	getAvailableModels(): ModelOption[] {
		return defaultModels;
	}

	/**
	 * Get the currently selected model
	 */
	getCurrentModel(): ModelOption {
		const selectedModel = this.plugin.settings.chatSettings?.selectedModel;
		return selectedModel || defaultModels[0];
	}

	/**
	 * Send a message to the Copilot API and get a response
	 */
	async sendMessageWrapped(
		options: CopilotAPIOptions,
	): Promise<CopilotAPIResponse> {
		const {
			prompt,
			model,
			temperature = 0,
			topP = 1,
			systemPrompt,
			messageHistory = [],
		} = options;

		// Get access token
		const accessToken = await this.getAccessToken();

		// Determine which model to use
		const modelToUse = model || this.getCurrentModel().value;

		// Build message array
		const messages: Array<{
			role: "user" | "assistant" | "system";
			content: string;
		}> = [];

		// Add system prompt if provided
		if (systemPrompt) {
			messages.push({
				role: "system",
				content: systemPrompt,
			});
		} else if (this.plugin.settings.systemPrompt) {
			// Use plugin's default system prompt if no custom one provided
			messages.push({
				role: "system",
				content: this.plugin.settings.systemPrompt,
			});
		}

		// Add message history
		messages.push(...messageHistory);

		// Add current prompt
		messages.push({
			role: "user",
			content: prompt,
		});

		// Prepare request
		const requestData: SendMessageRequest = {
			intent: false,
			model: modelToUse,
			temperature,
			top_p: topP,
			n: 1,
			stream: false,
			messages,
		};

		// Send request
		const response: SendMessageResponse = await sendMessage(
			requestData,
			accessToken,
		);

		console.log("Copilot API response:", { requestData, response });

		// Check response
		if (!response || !response.choices || response.choices.length === 0) {
			throw new Error("Invalid response from Copilot API");
		}

		// Return formatted response
		return {
			content: response.choices[0].message.content,
			model: response.model,
			id: response.id,
			usage: response.usage
				? {
						promptTokens: response.usage.prompt_tokens,
						completionTokens: response.usage.completion_tokens,
						totalTokens: response.usage.total_tokens,
					}
				: undefined,
		};
	}

	/**
	 * Check if user is authenticated
	 */
	async isAuthenticated(): Promise<boolean> {
		try {
			const secureManager = SecureCredentialManager.getInstance();
			const credentials = await secureManager.getCredentials(
				this.plugin.app,
			);

			if (!credentials?.pat || !credentials?.accessToken?.token) {
				return false;
			}

			const now = Date.now();
			const expiresAt = (credentials.accessToken.expiresAt || 0) * 1000;

			// Check if token is still valid (not expired)
			return now < expiresAt;
		} catch (error) {
			console.error("Error checking authentication:", error);
			return false;
		}
	}
}
