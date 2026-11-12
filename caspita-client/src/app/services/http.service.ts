import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';

@Injectable({ providedIn: 'root' })
export class HttpService {
  private readonly base = '/api';

  constructor(private http: HttpClient) {}

  get<T>(path: string, params?: Record<string, string>) {
    return this.http.get<T>(`${this.base}${path}`, { params });
  }

  post<T>(path: string, body: unknown) {
    return this.http.post<T>(`${this.base}${path}`, body);
  }

  put<T>(path: string, body: unknown) {
    return this.http.put<T>(`${this.base}${path}`, body);
  }

  delete<T>(path: string) {
    return this.http.delete<T>(`${this.base}${path}`);
  }
}
