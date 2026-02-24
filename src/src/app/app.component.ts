import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { SessionCreateComponent } from './components/session-create/session-create.component';
import { TerminalComponent } from './components/terminal/terminal.component';
import { SessionStateService, ActiveSession } from './services/session-state.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, SessionCreateComponent, TerminalComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent implements OnInit {
  title = 'Claude PowerTerminal';
  sessions: ActiveSession[] = [];

  constructor(private sessionStateService: SessionStateService) {}

  ngOnInit(): void {
    // Subscribe to session state changes
    this.sessionStateService.sessions$.subscribe(sessionsMap => {
      this.sessions = Array.from(sessionsMap.values());
    });
  }
}
