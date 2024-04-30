import { AbstractLiveClient } from "./AbstractLiveClient";
import { DeepgramError } from "../lib/errors";
import { LiveConnectionState, LiveTranscriptionEvents } from "../lib/enums";
import { w3cwebsocket } from "websocket";

import {
  type LiveSchema,
  type LiveConfigOptions,
  type LiveMetadataEvent,
  type LiveTranscriptionEvent,
  type DeepgramClientOptions,
  type UtteranceEndEvent,
  type SpeechStartedEvent,
} from "../lib/types";

export class LiveClient extends AbstractLiveClient {
  public namespace: string = "listen";
  protected _socket: w3cwebsocket;

  // Constructor implementation
  constructor(
    options: DeepgramClientOptions,
    transcriptionOptions: LiveSchema = {},
    endpoint: string = ":version/listen"
  ) {
    super(options);

    const requestUrl = this.getRequestUrl(endpoint, {}, transcriptionOptions);
    this._socket = new w3cwebsocket(requestUrl.toString(), ["token", this.key]);

    this._socket.onopen = () => {
      this.emit(LiveTranscriptionEvents.Open, this);
    };

    this._socket.onclose = (event: any) => {
      this.emit(LiveTranscriptionEvents.Close, event);
    };

    this._socket.onerror = (event) => {
      this.emit(LiveTranscriptionEvents.Error, event);
    };

    this._socket.onmessage = (event) => {
      try {
        const data: any = JSON.parse(event.data.toString());

        if (data.type === LiveTranscriptionEvents.Metadata) {
          this.emit(LiveTranscriptionEvents.Metadata, data as LiveMetadataEvent);
        }

        if (data.type === LiveTranscriptionEvents.Transcript) {
          this.emit(LiveTranscriptionEvents.Transcript, data as LiveTranscriptionEvent);
        }

        if (data.type === LiveTranscriptionEvents.UtteranceEnd) {
          this.emit(LiveTranscriptionEvents.UtteranceEnd, data as UtteranceEndEvent);
        }

        if (data.type === LiveTranscriptionEvents.SpeechStarted) {
          this.emit(LiveTranscriptionEvents.SpeechStarted, data as SpeechStartedEvent);
        }
      } catch (error) {
        this.emit(LiveTranscriptionEvents.Error, {
          event,
          message: "Unable to parse `data` as JSON.",
          error,
        });
      }
    };
  }

  public configure(config: LiveConfigOptions): void {
    this._socket.send(
      JSON.stringify({
        type: "Configure",
        processors: config,
      })
    );
  }

  public keepAlive(): void {
    this._socket.send(
      JSON.stringify({
        type: "KeepAlive",
      })
    );
  }

  public getReadyState(): LiveConnectionState {
    return this._socket.readyState;
  }

  /**
   * Sends data to the Deepgram API via websocket connection
   * @param data Audio data to send to Deepgram
   *
   * Conforms to RFC #146 for Node.js - does not send an empty byte.
   * In the browser, a Blob will contain length with no audio.
   * @see https://github.com/deepgram/deepgram-python-sdk/issues/146
   */
  public send(data: string | ArrayBufferLike | Blob): void {
    if (this._socket.readyState === LiveConnectionState.OPEN) {
      if (typeof data === "string") {
        this._socket.send(data); // send text data
      } else if ((data as any) instanceof Blob) {
        this._socket.send(data as unknown as ArrayBufferLike); // send blob data
      } else {
        const buffer = data as ArrayBufferLike;

        if (buffer.byteLength > 0) {
          this._socket.send(buffer); // send buffer when not zero-byte (or browser)
        } else {
          this.emit(
            LiveTranscriptionEvents.Warning,
            "Zero-byte detected, skipping. Send `CloseStream` if trying to close the connection."
          );
        }
      }
    } else {
      throw new DeepgramError("Could not send. Connection not open.");
    }
  }

  /**
   * Denote that you are finished sending audio and close
   * the websocket connection when transcription is finished
   */
  public finish(): void {
    // tell the server to close the socket
    this._socket.send(
      JSON.stringify({
        type: "CloseStream",
      })
    );
  }
}
