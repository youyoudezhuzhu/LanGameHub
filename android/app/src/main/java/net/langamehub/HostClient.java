package net.langamehub;

import android.content.Context;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.RandomAccessFile;
import java.net.HttpURLConnection;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.Proxy;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

final class HostClient {
    private final int port;
    private final String secret;

    HostClient(int port, String secret) {
        this.port = port;
        this.secret = secret;
    }

    JSONObject status() throws Exception {
        HttpURLConnection connection = connect("/api/host", "GET");
        try (InputStream input = connection.getInputStream()) {
            ByteArrayOutputStream body = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            int length;
            while ((length = input.read(buffer)) != -1) body.write(buffer, 0, length);
            return new JSONObject(body.toString("UTF-8"));
        } finally {
            connection.disconnect();
        }
    }

    boolean closeRoom(String code) throws IOException {
        if (!code.matches("[A-Z0-9]{4}")) return false;
        HttpURLConnection connection = connect("/api/host/rooms/" + code, "DELETE");
        try {
            return connection.getResponseCode() == 204;
        } finally {
            connection.disconnect();
        }
    }

    private HttpURLConnection connect(String path, String method) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL("http://127.0.0.1:" + port + path).openConnection(Proxy.NO_PROXY);
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(750);
        connection.setReadTimeout(1000);
        connection.setRequestMethod(method);
        connection.setRequestProperty("Authorization", "Bearer " + secret);
        return connection;
    }

    boolean websocketHealthy() {
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress("127.0.0.1", port), 700);
            socket.setSoTimeout(700);
            String host = "127.0.0.1:" + port;
            String request = "GET /ws HTTP/1.1\r\nHost: " + host + "\r\nOrigin: http://" + host
                    + "\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13"
                    + "\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n";
            socket.getOutputStream().write(request.getBytes(StandardCharsets.US_ASCII));
            ByteArrayOutputStream line = new ByteArrayOutputStream();
            InputStream input = socket.getInputStream();
            while (line.size() < 256) {
                int next = input.read();
                if (next == -1 || next == '\n') break;
                line.write(next);
            }
            return line.toString("US-ASCII").startsWith("HTTP/1.1 101 ");
        } catch (IOException error) {
            return false;
        }
    }

    static String tail(Context context, String name, int maximum) {
        try (RandomAccessFile file = new RandomAccessFile(new File(context.getFilesDir(), name), "r")) {
            int length = (int) Math.min(maximum, file.length());
            file.seek(file.length() - length);
            byte[] data = new byte[length];
            file.readFully(data);
            return new String(data, StandardCharsets.UTF_8);
        } catch (IOException error) {
            return "";
        }
    }
}
